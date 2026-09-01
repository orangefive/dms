import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalMetadataService } from '../external/external-metadata.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FieldType, TableType } from '../common/enums';

/** 列类型 → 字段类型映射（EXTERNAL 表） */
function mapColumnToFieldType(dataType: string, columnType: string): { type: FieldType; config: Record<string, unknown> } {
  switch (dataType) {
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'bigint':
    case 'decimal':
    case 'numeric':
    case 'float':
    case 'double':
      return { type: FieldType.NUMBER, config: {} };
    case 'char':
    case 'varchar':
      return { type: FieldType.SINGLE_LINE_TEXT, config: {} };
    case 'tinytext':
    case 'text':
    case 'mediumtext':
    case 'longtext':
    case 'json':
      return { type: FieldType.MULTI_LINE_TEXT, config: {} };
    case 'date':
      return { type: FieldType.DATE, config: { showTime: false } };
    case 'datetime':
    case 'timestamp':
      return { type: FieldType.DATE, config: { showTime: true } };
    case 'enum': {
      const options = parseEnumOptions(columnType);
      return { type: FieldType.SINGLE_SELECT, config: { options } };
    }
    case 'set': {
      const options = parseEnumOptions(columnType);
      return { type: FieldType.MULTI_SELECT, config: { options } };
    }
    default:
      // binary / blob / geometry 等类型不注册
      return { type: FieldType.SINGLE_LINE_TEXT, config: {} };
  }
}

function parseEnumOptions(columnType: string): Array<{ label: string; value: string }> {
  const m = /^(?:enum|set)\((.*)\)$/i.exec(columnType);
  if (!m) {
    return [];
  }
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of m[1]) {
    if (ch === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.map((p) => ({ label: p, value: p }));
}

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly externalMetadata: ExternalMetadataService,
    private readonly audit: AuditService,
  ) {}

  /** 生成稳定的 field_key：ASCII 名称直接 snake_case，否则 f_ + 短哈希 */
  static generateFieldKey(name: string): string {
    const cleaned = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (/^[a-z][a-z0-9_]*$/.test(cleaned)) {
      return cleaned;
    }
    let hash = 0;
    for (const ch of name) {
      hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    }
    return `f_${hash.toString(16).padStart(8, '0')}`;
  }

  async list(projectId?: string) {
    return this.prisma.dataTable.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'asc' },
      include: {
        project: { select: { id: true, name: true } },
        _count: { select: { fields: true, records: true } },
      },
    });
  }

  async get(id: string) {
    const table = await this.prisma.dataTable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        _count: { select: { fields: true, records: true } },
      },
    });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    return table;
  }

  async create(params: {
    projectId: string;
    name: string;
    description?: string;
    tableType: TableType;
    externalTableName?: string;
    operatorId: string;
    operatorName: string;
  }) {
    const project = await this.prisma.project.findUnique({ where: { id: params.projectId } });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, '项目不存在');
    }
    const dup = await this.prisma.dataTable.findFirst({
      where: { projectId: params.projectId, name: params.name.trim() },
    });
    if (dup) {
      throw AppError.badRequest(ErrorCodes.TABLE_NAME_TAKEN, '同一项目下已存在同名数据表');
    }

    let externalTableName: string | null = null;
    let externalMeta: Awaited<ReturnType<ExternalMetadataService['getTableMeta']>> | null = null;

    if (params.tableType === TableType.EXTERNAL) {
      if (!params.externalTableName) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, 'EXTERNAL 表必须指定物理表名');
      }
      // 元数据白名单校验：表名必须真实存在于 information_schema
      externalMeta = await this.externalMetadata.getTableMeta(params.externalTableName);
      externalTableName = externalMeta.name;
      // 同库同物理表只允许注册一次
      const registered = await this.prisma.dataTable.findFirst({
        where: { externalTableName, tableType: TableType.EXTERNAL },
      });
      if (registered) {
        throw AppError.badRequest(
          ErrorCodes.VALIDATION_ERROR,
          `物理表 "${externalTableName}" 已注册到数据表 "${registered.name}"`,
        );
      }
    }

    const table = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataTable.create({
        data: {
          projectId: params.projectId,
          name: params.name.trim(),
          description: params.description ?? null,
          tableType: params.tableType,
          externalTableName,
          createdBy: params.operatorId,
        },
      });

      if (params.tableType === TableType.EXTERNAL && externalMeta) {
        // 依据 information_schema 元数据自动生成字段（白名单）
        let order = 0;
        for (const col of externalMeta.columns) {
          if (col.dataType === 'binary' || col.dataType === 'varbinary' || col.dataType === 'blob' || col.dataType === 'longblob' || col.dataType === 'mediumblob' || col.dataType === 'tinyblob' || col.dataType === 'geometry' || col.dataType === 'point' || col.dataType === 'linestring' || col.dataType === 'polygon') {
            continue; // 跳过二进制/空间类型
          }
          const mapped = mapColumnToFieldType(col.dataType, col.columnType);
          order += 1;
          await tx.dataField.create({
            data: {
              tableId: created.id,
              name: col.name,
              fieldKey: col.name,
              fieldType: mapped.type,
              config: mapped.config as object,
              sortOrder: order,
              isUnique: col.columnKey === 'UNI' || col.columnKey === 'PRI',
              isIndexed: col.columnKey === 'UNI' || col.columnKey === 'PRI',
            },
          });
        }
      }
      return created;
    });

    await this.audit.record({
      action: 'TABLE_CREATE',
      userId: params.operatorId,
      resourceType: 'table',
      resourceId: table.id,
      detail: {
        name: table.name,
        type: table.tableType,
        externalTableName: table.externalTableName,
        by: params.operatorName,
      },
    });
    return table;
  }

  async update(
    id: string,
    params: { name?: string; description?: string; operatorId: string; operatorName: string },
  ) {
    const existing = await this.prisma.dataTable.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    if (params.name !== undefined && params.name.trim() !== existing.name) {
      const dup = await this.prisma.dataTable.findFirst({
        where: { projectId: existing.projectId, name: params.name.trim(), id: { not: id } },
      });
      if (dup) {
        throw AppError.badRequest(ErrorCodes.TABLE_NAME_TAKEN, '同一项目下已存在同名数据表');
      }
    }
    const table = await this.prisma.dataTable.update({
      where: { id },
      data: {
        ...(params.name !== undefined ? { name: params.name.trim() } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
      },
    });
    await this.audit.record({
      action: 'TABLE_UPDATE',
      userId: params.operatorId,
      resourceType: 'table',
      resourceId: id,
      detail: { name: table.name, by: params.operatorName },
    });
    return table;
  }

  async remove(id: string, operatorId: string, operatorName: string) {
    const existing = await this.prisma.dataTable.findUnique({
      where: { id },
      include: { _count: { select: { records: true, fields: true } } },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    await this.prisma.dataTable.delete({ where: { id } });
    await this.audit.record({
      action: 'TABLE_DELETE',
      userId: operatorId,
      resourceType: 'table',
      resourceId: id,
      detail: {
        name: existing.name,
        recordCount: existing._count.records,
        fieldCount: existing._count.fields,
        by: operatorName,
      },
    });
  }
}
