import { DataField } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { FieldType, TableType } from '../common/enums';
import { QueryFilter, QueryOperator, QuerySort } from './query.types';
import { normalizeNumber } from './query.validator';

/**
 * Query SQL 编译器。
 * - 所有值一律参数化（Prisma.sql 参数），杜绝 SQL 注入
 * - 表名/字段名只接受来自元数据白名单的标识符（SYSTEM: data_fields；EXTERNAL: information_schema 校验过的列）
 * - eq 严格精确匹配（BINARY / JSON 相等），绝不退化为 LIKE
 * - NUMBER 禁止 LIKE
 */
export class QueryCompiler {
  constructor(
    private readonly tableType: TableType,
    private readonly fields: DataField[],
    private readonly externalTableName?: string,
  ) {}

  private fieldByKey(key: string): DataField | undefined {
    return this.fields.find((f) => f.fieldKey === key);
  }

  /** SYSTEM 表：JSON 路径表达式 */
  private rawExpr(key: string): string {
    return `JSON_EXTRACT(data, '$.${key}')`;
  }

  private scalarExpr(key: string): string {
    return `JSON_UNQUOTE(JSON_EXTRACT(data, '$.${key}'))`;
  }

  private columnExpr(key: string): string {
    return `\`${key}\``;
  }

  /** 编译 WHERE 片段（AND 逻辑），并返回附加参数 */
  compileWhere(filters: QueryFilter[]): Prisma.Sql {
    if (filters.length === 0) {
      return Prisma.sql`1=1`;
    }
    const parts = filters.map((f) => this.compileCondition(f));
    if (parts.length === 1) {
      return parts[0];
    }
    return Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
  }

  private compileCondition(filter: QueryFilter): Prisma.Sql {
    const field = this.fieldByKey(filter.field);
    if (!field) {
      // 调用方已校验，此处兜底
      throw new Error(`QUERY_INVALID_FIELD: ${filter.field}`);
    }
    const { operator, value } = filter;

    switch (operator) {
      case 'is_null':
        return Prisma.sql`${Prisma.raw(this.accessor(field))} IS NULL`;
      case 'is_not_null':
        return Prisma.sql`${Prisma.raw(this.accessor(field))} IS NOT NULL`;
      default:
        return this.compileValueCondition(field, operator, value);
    }
  }

  /** 值比较条件（按字段类型与表类型分派） */
  private compileValueCondition(field: DataField, operator: QueryOperator, value: unknown): Prisma.Sql {
    const isSystem = this.tableType === TableType.SYSTEM;
    const type = field.fieldType;
    const numericLike =
      type === FieldType.NUMBER ||
      (type === FieldType.FORMULA && field.formulaResultType === 'NUMBER');

    if (numericLike) {
      return this.numberCondition(field, operator, value, isSystem);
    }
    if (type === FieldType.FORMULA && field.formulaResultType === 'BOOLEAN') {
      return this.booleanCondition(field, operator, value, isSystem);
    }
    if (type === FieldType.MULTI_SELECT) {
      return this.multiSelectCondition(field, operator, value, isSystem);
    }
    if (type === FieldType.DATE) {
      return this.dateCondition(field, operator, value, isSystem);
    }
    // STRING / SINGLE_LINE_TEXT / MULTI_LINE_TEXT / SINGLE_SELECT
    return this.stringCondition(field, operator, value);
  }

  private accessor(field: DataField): string {
    if (this.tableType === TableType.SYSTEM) {
      return this.rawExpr(field.fieldKey);
    }
    return this.columnExpr(field.fieldKey);
  }

  private scalar(field: DataField): string {
    if (this.tableType === TableType.SYSTEM) {
      return this.scalarExpr(field.fieldKey);
    }
    return this.columnExpr(field.fieldKey);
  }

  private stringCondition(field: DataField, op: QueryOperator, value: unknown): Prisma.Sql {
    const scalar = this.scalar(field);
    const raw = this.accessor(field);
    switch (op) {
      case 'eq': {
        // 大小写敏感精确匹配：BINARY 比较，绝不用 LIKE
        const v = String(value);
        return Prisma.sql`BINARY ${Prisma.raw(scalar)} = ${v}`;
      }
      case 'neq': {
        const v = String(value);
        return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR NOT (BINARY ${Prisma.raw(scalar)} = ${v}))`;
      }
      case 'contains':
        return Prisma.sql`${Prisma.raw(scalar)} LIKE ${this.likePattern(value, 'contains')}`;
      case 'not_contains':
        return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR ${Prisma.raw(scalar)} NOT LIKE ${this.likePattern(value, 'contains')})`;
      case 'starts_with':
        return Prisma.sql`${Prisma.raw(scalar)} LIKE ${this.likePattern(value, 'starts_with')}`;
      case 'ends_with':
        return Prisma.sql`${Prisma.raw(scalar)} LIKE ${this.likePattern(value, 'ends_with')}`;
      case 'in':
        return Prisma.sql`BINARY ${Prisma.raw(scalar)} IN (${Prisma.join(this.sqlParams(this.stringArray(value)), ', ')})`;
      case 'not_in':
        return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR BINARY ${Prisma.raw(scalar)} NOT IN (${Prisma.join(this.sqlParams(this.stringArray(value)), ', ')}))`;
      default:
        throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
    }
  }

  private numberCondition(field: DataField, op: QueryOperator, value: unknown, isSystem: boolean): Prisma.Sql {
    const raw = this.accessor(field);
    if (isSystem) {
      const expr = `CAST(${this.scalarExpr(field.fieldKey)} AS DECIMAL(65,10))`;
      const num = (v: unknown): number => normalizeNumber(v);
      switch (op) {
        case 'eq':
          return Prisma.sql`${Prisma.raw(expr)} = ${num(value)}`;
        case 'neq':
          return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR NOT (${Prisma.raw(expr)} = ${num(value)}))`;
        case 'gt':
          return Prisma.sql`${Prisma.raw(expr)} > ${num(value)}`;
        case 'gte':
          return Prisma.sql`${Prisma.raw(expr)} >= ${num(value)}`;
        case 'lt':
          return Prisma.sql`${Prisma.raw(expr)} < ${num(value)}`;
        case 'lte':
          return Prisma.sql`${Prisma.raw(expr)} <= ${num(value)}`;
        case 'in':
          return Prisma.sql`${Prisma.raw(expr)} IN (${Prisma.join(this.sqlParams(this.numberArray(value)), ', ')})`;
        case 'not_in':
          return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR ${Prisma.raw(expr)} NOT IN (${Prisma.join(this.sqlParams(this.numberArray(value)), ', ')}))`;
        default:
          throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
      }
    }
    // EXTERNAL：直接列比较（MySQL 自动类型转换），禁止 LIKE
    const col = this.columnExpr(field.fieldKey);
    const num = (v: unknown): number => normalizeNumber(v);
    switch (op) {
      case 'eq':
        return Prisma.sql`${Prisma.raw(col)} = ${num(value)}`;
      case 'neq':
        return Prisma.sql`(${Prisma.raw(col)} IS NULL OR NOT (${Prisma.raw(col)} = ${num(value)}))`;
      case 'gt':
        return Prisma.sql`${Prisma.raw(col)} > ${num(value)}`;
      case 'gte':
        return Prisma.sql`${Prisma.raw(col)} >= ${num(value)}`;
      case 'lt':
        return Prisma.sql`${Prisma.raw(col)} < ${num(value)}`;
      case 'lte':
        return Prisma.sql`${Prisma.raw(col)} <= ${num(value)}`;
      case 'in':
        return Prisma.sql`${Prisma.raw(col)} IN (${Prisma.join(this.sqlParams(this.numberArray(value)), ', ')})`;
      case 'not_in':
        return Prisma.sql`(${Prisma.raw(col)} IS NULL OR ${Prisma.raw(col)} NOT IN (${Prisma.join(this.sqlParams(this.numberArray(value)), ', ')}))`;
      default:
        throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
    }
  }

  private booleanCondition(field: DataField, op: QueryOperator, value: unknown, isSystem: boolean): Prisma.Sql {
    if (isSystem) {
      const raw = this.accessor(field);
      const json = JSON.stringify(Boolean(value));
      switch (op) {
        case 'eq':
          return Prisma.sql`${Prisma.raw(raw)} = CAST(${json} AS JSON)`;
        case 'neq':
          return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR NOT (${Prisma.raw(raw)} = CAST(${json} AS JSON)))`;
        default:
          throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
      }
    }
    const col = this.columnExpr(field.fieldKey);
    const b = value ? 1 : 0;
    switch (op) {
      case 'eq':
        return Prisma.sql`${Prisma.raw(col)} = ${b}`;
      case 'neq':
        return Prisma.sql`(${Prisma.raw(col)} IS NULL OR NOT (${Prisma.raw(col)} = ${b}))`;
      default:
        throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
    }
  }

  private dateCondition(field: DataField, op: QueryOperator, value: unknown, isSystem: boolean): Prisma.Sql {
    const v = String(value);
    if (isSystem) {
      const scalar = this.scalarExpr(field.fieldKey);
      const raw = this.accessor(field);
      switch (op) {
        case 'eq':
          return Prisma.sql`BINARY ${Prisma.raw(scalar)} = ${v}`;
        case 'neq':
          return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR NOT (BINARY ${Prisma.raw(scalar)} = ${v}))`;
        case 'gt':
          return Prisma.sql`${Prisma.raw(scalar)} > ${v}`;
        case 'gte':
          return Prisma.sql`${Prisma.raw(scalar)} >= ${v}`;
        case 'lt':
          return Prisma.sql`${Prisma.raw(scalar)} < ${v}`;
        case 'lte':
          return Prisma.sql`${Prisma.raw(scalar)} <= ${v}`;
        default:
          throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
      }
    }
    // EXTERNAL DATE/DATETIME 列：交给 MySQL 进行日期类型转换
    const col = this.columnExpr(field.fieldKey);
    switch (op) {
      case 'eq':
        return Prisma.sql`${Prisma.raw(col)} = ${v}`;
      case 'neq':
        return Prisma.sql`(${Prisma.raw(col)} IS NULL OR NOT (${Prisma.raw(col)} = ${v}))`;
      case 'gt':
        return Prisma.sql`${Prisma.raw(col)} > ${v}`;
      case 'gte':
        return Prisma.sql`${Prisma.raw(col)} >= ${v}`;
      case 'lt':
        return Prisma.sql`${Prisma.raw(col)} < ${v}`;
      case 'lte':
        return Prisma.sql`${Prisma.raw(col)} <= ${v}`;
      default:
        throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
    }
  }

  private multiSelectCondition(field: DataField, op: QueryOperator, value: unknown, isSystem: boolean): Prisma.Sql {
    const v = String(value);
    if (isSystem) {
      const raw = this.accessor(field);
      const jsonCandidate = JSON.stringify(v);
      switch (op) {
        case 'contains':
          return Prisma.sql`JSON_CONTAINS(${Prisma.raw(raw)}, ${jsonCandidate})`;
        case 'not_contains':
          return Prisma.sql`(${Prisma.raw(raw)} IS NULL OR NOT JSON_CONTAINS(${Prisma.raw(raw)}, ${jsonCandidate}))`;
        default:
          throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
      }
    }
    // EXTERNAL SET 列
    const col = this.columnExpr(field.fieldKey);
    switch (op) {
      case 'contains':
        return Prisma.sql`FIND_IN_SET(${v}, ${Prisma.raw(col)})`;
      case 'not_contains':
        return Prisma.sql`(${Prisma.raw(col)} IS NULL OR NOT FIND_IN_SET(${v}, ${Prisma.raw(col)}))`;
      default:
        throw new Error(`QUERY_INVALID_OPERATOR: ${op}`);
    }
  }

  /** 编译 ORDER BY（字段来自元数据白名单） */
  compileOrderBy(sort: QuerySort[]): Prisma.Sql {
    if (sort.length === 0) {
      return Prisma.sql`1=1`;
    }
    const parts = sort.map((s) => {
      const field = this.fieldByKey(s.field);
      if (!field) {
        throw new Error(`QUERY_INVALID_FIELD: ${s.field}`);
      }
      const dir = s.order === 'desc' ? 'DESC' : 'ASC';
      const numericLike =
        field.fieldType === FieldType.NUMBER ||
        (field.fieldType === FieldType.FORMULA && field.formulaResultType === 'NUMBER');
      if (this.tableType === TableType.SYSTEM) {
        const expr = numericLike
          ? `CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.${field.fieldKey}')) AS DECIMAL(65,10))`
          : `JSON_UNQUOTE(JSON_EXTRACT(data, '$.${field.fieldKey}'))`;
        return Prisma.sql`${Prisma.raw(expr)} ${Prisma.raw(dir)}`;
      }
      return Prisma.sql`${Prisma.raw(this.columnExpr(field.fieldKey))} ${Prisma.raw(dir)}`;
    });
    return Prisma.join(parts, ', ');
  }

  /** EXTERNAL 表名（白名单校验过的标识符） */
  externalTable(): string {
    if (!this.externalTableName) {
      throw new Error('EXTERNAL_TABLE_NOT_FOUND');
    }
    return `\`${this.externalTableName}\``;
  }

  /** EXTERNAL 查询的列清单 */
  selectColumns(): Prisma.Sql {
    return Prisma.join(
      this.fields.map((f) => Prisma.sql`${Prisma.raw(this.columnExpr(f.fieldKey))}`),
      ', ',
    );
  }

  // ---- 工具 ----

  private likePattern(value: unknown, kind: 'contains' | 'starts_with' | 'ends_with'): string {
    const escaped = String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
    switch (kind) {
      case 'contains':
        return `%${escaped}%`;
      case 'starts_with':
        return `${escaped}%`;
      case 'ends_with':
        return `%${escaped}`;
    }
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new Error('QUERY_INVALID_VALUE');
    }
    return value.map((v) => String(v));
  }

  private numberArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
      throw new Error('QUERY_INVALID_VALUE');
    }
    return value.map((v) => normalizeNumber(v));
  }

  private sqlParams(values: Array<string | number>): Prisma.Sql[] {
    return values.map((v) => Prisma.sql`${v}`);
  }
}
