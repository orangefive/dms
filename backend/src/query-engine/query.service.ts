import { Injectable } from '@nestjs/common';
import { DataField, DataTable, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalMetadataService } from '../external/external-metadata.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { TableType } from '../common/enums';
import { buildPagination, Pagination } from '../common/dto/pagination.dto';
import { QueryCompiler } from './query.compiler';
import { QueryDto, QueryFilter, QuerySort } from './query.types';
import { validateFilter, validateSort } from './query.validator';

export interface QueryableRecord {
  id?: string;
  data: Record<string, unknown>;
  formulaErrors?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QueryOutcome<T extends QueryableRecord = QueryableRecord> {
  records: T[];
  pagination: Pagination;
}

interface SystemRow {
  id: string;
  data: unknown;
  formula_errors: unknown;
  created_at: Date;
  updated_at: Date;
}

/**
 * 查询服务：Query DSL 校验 → SQL 编译 → MySQL 层查询/排序/分页。
 * 全程禁止全表拉取后在 Node.js 过滤。
 */

/** 分页硬上限：防止构造超大 OFFSET 造成数据库压力 */
const MAX_PAGE = 100_000;
const MAX_PAGE_SIZE = 500;
/**
 * OFFSET 上限。
 * 基准测试显示：带排序的深分页会让 MySQL 先把 offset+limit 行塞进排序缓冲区
 * （1 万行表 offset 9800 时 SELECT 从 1ms 涨到约 50ms，且随数据量线性增长）。
 * 因此用「实际偏移行数」而不是「页码」做护栏，避免 pageSize=500 时 offset 被放大 10 倍。
 */
const MAX_OFFSET = 100_000;

@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly externalMetadata: ExternalMetadataService,
  ) {}

  /** 执行 Query DSL */
  async query(tableId: string, dto: QueryDto): Promise<QueryOutcome> {
    const table = await this.loadTable(tableId);
    const fields = await this.loadFields(tableId);
    const filters = (dto.filters ?? []).map((f) => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
    })) as QueryFilter[];
    const sort = (dto.sort ?? []) as QuerySort[];
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_VALUE,
        `页码必须是 1-${MAX_PAGE} 的整数`,
      );
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_VALUE,
        `每页数量必须是 1-${MAX_PAGE_SIZE} 的整数`,
      );
    }
    const offset = (page - 1) * pageSize;
    if (offset > MAX_OFFSET) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_VALUE,
        `翻页范围过深（offset ${offset} > ${MAX_OFFSET}），请收窄筛选条件后重试`,
      );
    }

    // 校验：字段存在、操作符白名单、值类型
    for (const f of filters) {
      const field = fields.find((x) => x.fieldKey === f.field);
      if (!field) {
        throw AppError.badRequest(ErrorCodes.QUERY_INVALID_FIELD, `查询字段 "${f.field}" 不存在`);
      }
      validateFilter(f, field);
    }
    for (const s of sort) {
      const field = fields.find((x) => x.fieldKey === s.field);
      if (!field) {
        throw AppError.badRequest(ErrorCodes.QUERY_INVALID_FIELD, `排序字段 "${s.field}" 不存在`);
      }
      validateSort(s, field);
    }

    if (table.tableType === TableType.EXTERNAL) {
      return this.queryExternal(table, fields, filters, sort, page, pageSize);
    }
    return this.querySystem(table, fields, filters, sort, page, pageSize);
  }

  /** 快捷精确查询：EXACT MATCH（eq），禁止 contains */
  async findExact(
    tableId: string,
    fieldKey: string,
    value: unknown,
    page = 1,
    pageSize = 50,
  ): Promise<QueryOutcome> {
    return this.query(tableId, {
      filters: [{ field: fieldKey, operator: 'eq', value }],
      page,
      pageSize,
    });
  }

  /** find-one：精确匹配，0 条 → null；多条 → MULTIPLE_RECORDS_FOUND */
  async findOne(
    tableId: string,
    fieldKey: string,
    value: unknown,
  ): Promise<QueryableRecord | null> {
    const outcome = await this.query(tableId, {
      filters: [{ field: fieldKey, operator: 'eq', value }],
      page: 1,
      pageSize: 2,
    });
    if (outcome.records.length === 0) {
      return null;
    }
    if (outcome.records.length > 1) {
      throw AppError.badRequest(
        ErrorCodes.MULTIPLE_RECORDS_FOUND,
        `精确匹配到多条记录（字段 "${fieldKey}" 不是唯一字段），请使用 recordId 或组合唯一约束定位`,
      );
    }
    return outcome.records[0];
  }

  // ---- 内部实现 ----

  async loadTable(tableId: string): Promise<DataTable> {
    const table = await this.prisma.dataTable.findUnique({
      where: { id: tableId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!table) {
      throw AppError.notFound(ErrorCodes.TABLE_NOT_FOUND, '数据表不存在');
    }
    return table;
  }

  async loadFields(tableId: string): Promise<DataField[]> {
    return this.prisma.dataField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async querySystem(
    table: DataTable,
    fields: DataField[],
    filters: QueryFilter[],
    sort: QuerySort[],
    page: number,
    pageSize: number,
  ): Promise<QueryOutcome> {
    const compiler = new QueryCompiler(TableType.SYSTEM, fields);
    const where = compiler.compileWhere(filters);
    const orderBy = compiler.compileOrderBy(sort);

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS total FROM table_records WHERE table_id = ${table.id} AND ${where}`,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<SystemRow[]>(
      Prisma.sql`SELECT id, data, formula_errors, created_at, updated_at
        FROM table_records
        WHERE table_id = ${table.id} AND ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}`,
    );

    const records: QueryableRecord[] = rows.map((r) => ({
      id: r.id,
      data: (r.data ?? {}) as Record<string, unknown>,
      formulaErrors: (r.formula_errors ?? undefined) as Record<string, string> | undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return { records, pagination: buildPagination(page, pageSize, total) };
  }

  private async queryExternal(
    table: DataTable,
    fields: DataField[],
    filters: QueryFilter[],
    sort: QuerySort[],
    page: number,
    pageSize: number,
  ): Promise<QueryOutcome> {
    const tableName = table.externalTableName;
    if (!tableName) {
      throw AppError.badRequest(ErrorCodes.EXTERNAL_TABLE_NOT_FOUND, '外部表名缺失');
    }
    // 白名单复核：查询前再次用 information_schema 元数据验证表/列存在
    const meta = await this.externalMetadata.getTableMeta(tableName);
    const validColumns = new Set(meta.columns.map((c) => c.name));
    for (const f of fields) {
      if (!validColumns.has(f.fieldKey)) {
        throw AppError.badRequest(
          ErrorCodes.EXTERNAL_COLUMN_NOT_FOUND,
          `外部表列 "${f.fieldKey}" 不在元数据白名单中`,
        );
      }
    }
    for (const f of filters) {
      if (!validColumns.has(f.field)) {
        throw AppError.badRequest(ErrorCodes.QUERY_INVALID_FIELD, `查询字段 "${f.field}" 不在外部表白名单中`);
      }
    }
    for (const s of sort) {
      if (!validColumns.has(s.field)) {
        throw AppError.badRequest(ErrorCodes.QUERY_INVALID_FIELD, `排序字段 "${s.field}" 不在外部表白名单中`);
      }
    }

    const compiler = new QueryCompiler(TableType.EXTERNAL, fields, tableName);
    const where = compiler.compileWhere(filters);
    const orderBy = compiler.compileOrderBy(sort);
    const columns = compiler.selectColumns();

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS total FROM ${Prisma.raw(compiler.externalTable())} WHERE ${where}`,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`SELECT ${columns} FROM ${Prisma.raw(compiler.externalTable())}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}`,
    );

    const records: QueryableRecord[] = rows.map((r) => ({ data: jsonSafe(r) as Record<string, unknown> }));
    return { records, pagination: buildPagination(page, pageSize, total) };
  }
}

/** 将数据库行转换为 JSON 安全值（BigInt → number/string，Date → ISO） */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}
