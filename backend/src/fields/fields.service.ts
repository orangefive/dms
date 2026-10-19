import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FormulaService } from '../formula/formula.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FieldType, TableType } from '../common/enums';
import { TablesService } from '../tables/tables.service';
import { extractUniqueValues, hashUniqueValues } from '../common/unique-hash';

export interface SelectOption {
  label: string;
  value: string;
}

export interface FieldConfig {
  options?: SelectOption[];
  showTime?: boolean;
  maxLength?: number;
}

export interface FieldCreateParams {
  tableId: string;
  name: string;
  fieldKey?: string;
  fieldType: FieldType;
  config?: FieldConfig;
  isUnique?: boolean;
  isIndexed?: boolean;
  formulaExpression?: string;
  operatorId: string;
  operatorName: string;
}

export interface FieldUpdateParams {
  name?: string;
  config?: FieldConfig;
  isUnique?: boolean;
  isIndexed?: boolean;
  formulaExpression?: string;
  operatorId: string;
  operatorName: string;
}

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formulaService: FormulaService,
    private readonly audit: AuditService,
  ) {}

  async list(tableId: string) {
    return this.prisma.dataField.findMany({
      where: { tableId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(params: FieldCreateParams): Promise<unknown> {
    const table = await this.prisma.dataTable.findUnique({ where: { id: params.tableId } });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    if (table.tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(
        ErrorCodes.EXTERNAL_TABLE_READ_ONLY,
        'EXTERNAL 表字段由数据库元数据自动生成，不允许手工修改',
      );
    }

    const name = params.name.trim();
    if (name.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '字段名称不能为空');
    }
    const dupName = await this.prisma.dataField.findFirst({
      where: { tableId: params.tableId, name },
    });
    if (dupName) {
      throw AppError.badRequest(ErrorCodes.FIELD_NAME_TAKEN, `字段名称 "${name}" 已存在`);
    }

    // 生成唯一 field_key（可显式指定，便于 n8n / 公式引用）
    let fieldKey = params.fieldKey?.trim();
    if (fieldKey) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldKey)) {
        throw AppError.badRequest(
          ErrorCodes.VALIDATION_ERROR,
          '字段标识只能包含字母、数字、下划线，且不能以数字开头',
        );
      }
      const dupKey = await this.prisma.dataField.findFirst({
        where: { tableId: params.tableId, fieldKey },
      });
      if (dupKey) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, `字段标识 "${fieldKey}" 已存在`);
      }
    } else {
      fieldKey = TablesService.generateFieldKey(name);
      if (await this.prisma.dataField.findFirst({ where: { tableId: params.tableId, fieldKey } })) {
        fieldKey = `${fieldKey}_${Date.now().toString(36).slice(-4)}`;
      }
    }

    this.assertConfig(params.fieldType, params.config);
    if (params.isUnique) {
      this.assertUniqueable(params.fieldType);
    }

    const sortOrder = (await this.prisma.dataField.count({ where: { tableId: params.tableId } })) + 1;

    // FORMULA：先校验并生成 AST
    let formulaAst: object | null = null;
    let formulaResultType: string | null = null;
    let formulaExpression: string | null = null;
    if (params.fieldType === FieldType.FORMULA) {
      if (!params.formulaExpression) {
        throw AppError.badRequest(ErrorCodes.FORMULA_SYNTAX_ERROR, '公式字段必须提供公式表达式');
      }
      const validated = await this.formulaService.validateExpression(
        params.tableId,
        params.formulaExpression,
        undefined,
        name,
      );
      formulaAst = validated.ast;
      formulaResultType = validated.resultType;
      formulaExpression = validated.normalized;
    }

    const field = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataField.create({
        data: {
          tableId: params.tableId,
          name,
          fieldKey,
          fieldType: params.fieldType,
          config: (params.config ?? {}) as object,
          sortOrder,
          isUnique: Boolean(params.isUnique),
          isIndexed: Boolean(params.isIndexed),
          formulaExpression,
          formulaAst: formulaAst ?? Prisma.DbNull,
          formulaResultType,
        },
      });
      if (params.isUnique) {
        // 单字段唯一 → 自动创建唯一约束，并回填已有记录（重复则整体回滚）
        const constraint = await tx.uniqueConstraint.create({
          data: {
            tableId: params.tableId,
            name: `uq_${fieldKey}`,
            fields: [fieldKey] as unknown as object,
          },
        });
        await this.backfillUniqueConstraint(tx, params.tableId, constraint.id, [fieldKey]);
      }
      return created;
    });

    await this.audit.record({
      action: 'FIELD_CREATE',
      userId: params.operatorId,
      resourceType: 'field',
      resourceId: field.id,
      detail: {
        tableId: params.tableId,
        name: field.name,
        fieldKey: field.fieldKey,
        fieldType: field.fieldType,
        isUnique: field.isUnique,
        by: params.operatorName,
      },
    });

    // 公式字段创建后重算已有记录
    if (params.fieldType === FieldType.FORMULA) {
      await this.formulaService.recalculateTable(params.tableId);
    }
    return field;
  }

  async update(id: string, params: FieldUpdateParams): Promise<unknown> {
    const field = await this.prisma.dataField.findUnique({ where: { id } });
    if (!field) {
      throw AppError.notFound(ErrorCodes.FIELD_NOT_FOUND, '字段不存在');
    }
    const table = await this.prisma.dataTable.findUnique({ where: { id: field.tableId } });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    if (table.tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(
        ErrorCodes.EXTERNAL_TABLE_READ_ONLY,
        'EXTERNAL 表字段由数据库元数据自动生成，不允许手工修改',
      );
    }

    const data: Record<string, unknown> = {};

    if (params.name !== undefined) {
      const name = params.name.trim();
      if (name.length === 0) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '字段名称不能为空');
      }
      const dup = await this.prisma.dataField.findFirst({
        where: { tableId: field.tableId, name, id: { not: id } },
      });
      if (dup) {
        throw AppError.badRequest(ErrorCodes.FIELD_NAME_TAKEN, `字段名称 "${name}" 已存在`);
      }
      data.name = name;
    }

    if (params.config !== undefined) {
      this.assertConfig(field.fieldType, params.config);
      data.config = params.config;
    }

    if (params.isUnique !== undefined) {
      if (params.isUnique) {
        this.assertUniqueable(field.fieldType);
      }
      data.isUnique = params.isUnique;
    }
    if (params.isIndexed !== undefined) {
      data.isIndexed = params.isIndexed;
    }

    // 公式表达式修改 → 重新校验 + 版本号 + 标记重算
    let needRecalc = false;
    if (params.formulaExpression !== undefined && field.fieldType === FieldType.FORMULA) {
      const validated = await this.formulaService.validateExpression(
        field.tableId,
        params.formulaExpression,
        field.id,
      );
      data.formulaExpression = validated.normalized;
      data.formulaAst = validated.ast;
      data.formulaResultType = validated.resultType;
      data.formulaVersion = { increment: 1 };
      needRecalc = true;
    } else if (params.formulaExpression !== undefined) {
      throw AppError.badRequest(
        ErrorCodes.FORMULA_FIELD_READ_ONLY,
        '只有 FORMULA 类型字段可以设置公式表达式',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.dataField.update({ where: { id }, data });

      // is_unique 切换 → 同步创建/删除单字段唯一约束
      if (params.isUnique !== undefined && params.isUnique !== field.isUnique) {
        if (params.isUnique) {
          const constraint = await tx.uniqueConstraint.create({
            data: {
              tableId: field.tableId,
              name: `uq_${field.fieldKey}`,
              fields: [field.fieldKey] as unknown as object,
            },
          });
          await this.backfillUniqueConstraint(tx, field.tableId, constraint.id, [field.fieldKey]);
        } else {
          const constraint = await tx.uniqueConstraint.findFirst({
            where: { tableId: field.tableId, name: `uq_${field.fieldKey}` },
          });
          if (constraint) {
            await tx.uniqueConstraint.delete({ where: { id: constraint.id } });
          }
        }
      }
      return result;
    });

    await this.audit.record({
      action: 'FIELD_UPDATE',
      userId: params.operatorId,
      resourceType: 'field',
      resourceId: id,
      detail: {
        tableId: field.tableId,
        name: updated.name,
        fieldKey: updated.fieldKey,
        changed: {
          name: params.name !== undefined,
          config: params.config !== undefined,
          isUnique: params.isUnique !== undefined,
          isIndexed: params.isIndexed !== undefined,
          formula: params.formulaExpression !== undefined,
        },
        by: params.operatorName,
      },
    });

    if (needRecalc) {
      // 公式定义修改 → 重算历史记录
      await this.formulaService.recalculateTable(field.tableId);
    }
    return updated;
  }

  async remove(id: string, operatorId: string, operatorName: string): Promise<void> {
    const field = await this.prisma.dataField.findUnique({ where: { id } });
    if (!field) {
      throw AppError.notFound(ErrorCodes.FIELD_NOT_FOUND, '字段不存在');
    }
    const table = await this.prisma.dataTable.findUnique({ where: { id: field.tableId } });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    if (table.tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(
        ErrorCodes.EXTERNAL_TABLE_READ_ONLY,
        'EXTERNAL 表字段由数据库元数据自动生成，不允许手工修改',
      );
    }

    // 公式依赖保护：被公式引用的字段禁止删除
    const referencing = await this.formulaService.findFormulaReferences(
      field.tableId,
      field.fieldKey,
    );
    if (referencing.length > 0) {
      throw AppError.badRequest(
        ErrorCodes.FIELD_REFERENCED_BY_FORMULA,
        `字段 "${field.name}" 被以下公式字段引用，无法删除: ${referencing.map((f) => f.name).join('、')}`,
      );
    }

    // 唯一约束保护
    const constraints = await this.prisma.uniqueConstraint.findMany({
      where: { tableId: field.tableId },
    });
    const inConstraint = constraints.filter((c) => {
      const keys = c.fields as unknown;
      return Array.isArray(keys) && keys.includes(field.fieldKey);
    });
    if (inConstraint.length > 0) {
      throw AppError.badRequest(
        ErrorCodes.FIELD_IN_UNIQUE_CONSTRAINT,
        `字段 "${field.name}" 属于唯一约束 "${inConstraint[0].name}"，请先删除该约束`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // 用一条 JSON_REMOVE 清理所有记录中的该字段，避免把全表记录读进 Node 内存
      const path = `$.${field.fieldKey}`;
      await tx.$executeRaw(
        Prisma.sql`UPDATE table_records
          SET data = JSON_REMOVE(data, ${path})
          WHERE table_id = ${field.tableId}
            AND JSON_CONTAINS_PATH(data, 'one', ${path}) = 1`,
      );
      await tx.dataField.delete({ where: { id } });
    });

    await this.audit.record({
      action: 'FIELD_DELETE',
      userId: operatorId,
      resourceType: 'field',
      resourceId: id,
      detail: {
        tableId: field.tableId,
        name: field.name,
        fieldKey: field.fieldKey,
        fieldType: field.fieldType,
        by: operatorName,
      },
    });
  }

  /** 调整字段顺序 */
  async reorder(tableId: string, orderedIds: string[], operatorId: string, operatorName: string) {
    const fields = await this.prisma.dataField.findMany({
      where: { tableId },
      select: { id: true },
    });
    const validIds = new Set(fields.map((f) => f.id));
    if (orderedIds.length !== fields.length || orderedIds.some((id) => !validIds.has(id))) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '排序字段列表与表字段不一致');
    }
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.dataField.update({ where: { id }, data: { sortOrder: index + 1 } }),
      ),
    );
    await this.audit.record({
      action: 'FIELD_UPDATE',
      userId: operatorId,
      resourceType: 'table',
      resourceId: tableId,
      detail: { reorder: true, by: operatorName },
    });
    return { reordered: true };
  }

  // ---- 唯一约束（组合） ----

  async listConstraints(tableId: string) {
    return this.prisma.uniqueConstraint.findMany({
      where: { tableId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createConstraint(
    tableId: string,
    name: string,
    fieldKeys: string[],
    operatorId?: string,
    operatorName?: string,
  ) {
    const table = await this.prisma.dataTable.findUnique({ where: { id: tableId } });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    if (table.tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(ErrorCodes.EXTERNAL_TABLE_READ_ONLY, 'EXTERNAL 表不支持创建唯一约束');
    }
    if (fieldKeys.length === 0) {
      throw AppError.badRequest(ErrorCodes.UNIQUE_CONSTRAINT_INVALID, '唯一约束至少需要 1 个字段');
    }
    const unique = new Set(fieldKeys);
    if (unique.size !== fieldKeys.length) {
      throw AppError.badRequest(ErrorCodes.UNIQUE_CONSTRAINT_INVALID, '唯一约束字段不能重复');
    }
    const fields = await this.prisma.dataField.findMany({ where: { tableId } });
    const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
    for (const key of fieldKeys) {
      const f = byKey.get(key);
      if (!f) {
        throw AppError.badRequest(ErrorCodes.FIELD_NOT_FOUND, `字段 "${key}" 不存在`);
      }
      if (f.fieldType === FieldType.MULTI_SELECT) {
        throw AppError.badRequest(
          ErrorCodes.UNIQUE_CONSTRAINT_INVALID,
          `字段 "${f.name}" 为多选类型，不能参与唯一约束`,
        );
      }
      if (f.fieldType === FieldType.FORMULA) {
        throw AppError.badRequest(
          ErrorCodes.UNIQUE_CONSTRAINT_INVALID,
          `字段 "${f.name}" 为公式字段，不能参与唯一约束`,
        );
      }
    }
    const dup = await this.prisma.uniqueConstraint.findFirst({
      where: { tableId, name },
    });
    if (dup) {
      throw AppError.badRequest(ErrorCodes.UNIQUE_CONSTRAINT_INVALID, `约束名称 "${name}" 已存在`);
    }
    const constraint = await this.prisma.$transaction(async (tx) => {
      const created = await tx.uniqueConstraint.create({
        data: {
          tableId,
          name,
          fields: fieldKeys as unknown as object,
        },
      });
      // 回填历史记录；若已有重复值，唯一索引会触发 P2002 → 整个事务回滚
      await this.backfillUniqueConstraint(tx, tableId, created.id, fieldKeys);
      return created;
    });
    await this.audit.record({
      action: 'FIELD_UPDATE',
      userId: operatorId ?? null,
      resourceType: 'unique_constraint',
      resourceId: constraint.id,
      detail: { tableId, name, fields: fieldKeys, by: operatorName ?? null },
    });
    return constraint;
  }

  async removeConstraint(id: string) {
    const constraint = await this.prisma.uniqueConstraint.findUnique({ where: { id } });
    if (!constraint) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '唯一约束不存在');
    }
    await this.prisma.uniqueConstraint.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * 回填唯一约束索引（历史记录）。
   * 在事务内执行：一旦发现重复值（UniqueValue 唯一索引冲突），整个字段/约束创建回滚，
   * 不会出现“约束建好了但历史重复数据没被约束”的半成品状态。
   */
  private async backfillUniqueConstraint(
    tx: Prisma.TransactionClient,
    tableId: string,
    constraintId: string,
    keys: string[],
  ): Promise<void> {
    const batchSize = 500;
    let cursor: string | undefined;
    try {
      for (;;) {
        const batch = await tx.tableRecord.findMany({
          where: { tableId },
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, data: true },
        });
        if (batch.length === 0) {
          break;
        }
        cursor = batch[batch.length - 1].id;
        const rows: Array<{
          constraintId: string;
          recordId: string;
          valuesHash: string;
          values: object;
        }> = [];
        for (const record of batch) {
          const values = extractUniqueValues(
            (record.data ?? {}) as Record<string, unknown>,
            keys,
          );
          if (!values) {
            continue;
          }
          rows.push({
            constraintId,
            recordId: record.id,
            valuesHash: hashUniqueValues(values),
            values: values as object,
          });
        }
        if (rows.length > 0) {
          await tx.uniqueValue.createMany({ data: rows });
        }
        if (batch.length < batchSize) {
          break;
        }
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.badRequest(
          ErrorCodes.UNIQUE_CONSTRAINT_INVALID,
          `已有记录在字段组合 [${keys.join(', ')}] 上存在重复值，无法创建唯一约束`,
        );
      }
      throw err;
    }
  }

  // ---- 校验 ----

  private assertUniqueable(fieldType: string): void {
    if (fieldType === FieldType.MULTI_SELECT || fieldType === FieldType.FORMULA) {
      throw AppError.badRequest(
        ErrorCodes.UNIQUE_CONSTRAINT_INVALID,
        `${fieldType === FieldType.FORMULA ? '公式字段' : '多选字段'}不支持唯一约束`,
      );
    }
  }

  private assertConfig(fieldType: string, config?: FieldConfig): void {
    if (
      (fieldType === FieldType.SINGLE_SELECT || fieldType === FieldType.MULTI_SELECT) &&
      (!config?.options || config.options.length === 0)
    ) {
      throw AppError.badRequest(ErrorCodes.SELECT_OPTIONS_REQUIRED, '单选/多选字段必须配置至少一个选项');
    }
    if (config?.options) {
      const values = config.options.map((o) => o.value);
      const seen = new Set<string>();
      for (const v of values) {
        if (seen.has(v)) {
          throw AppError.badRequest(ErrorCodes.DUPLICATE_SELECT_OPTION, `选项值 "${v}" 重复`);
        }
        seen.add(v);
      }
      for (const o of config.options) {
        if (!o.label || !o.value) {
          throw AppError.badRequest(ErrorCodes.INVALID_FIELD_CONFIG, '选项的 label 与 value 不能为空');
        }
      }
    }
    if (fieldType === FieldType.DATE && config?.showTime !== undefined && typeof config.showTime !== 'boolean') {
      throw AppError.badRequest(ErrorCodes.INVALID_FIELD_CONFIG, 'showTime 必须是布尔值');
    }
  }
}
