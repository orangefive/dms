/** Query DSL 类型定义 */

/** 操作符白名单 */
export const QUERY_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
] as const;

export type QueryOperator = (typeof QUERY_OPERATORS)[number];

export type QueryLogic = 'AND';

export interface QueryFilter {
  field: string;
  operator: QueryOperator;
  value?: unknown;
}

export interface QuerySort {
  field: string;
  order: 'asc' | 'desc';
}

export interface QueryDto {
  filters?: QueryFilter[];
  logic?: QueryLogic;
  sort?: QuerySort[];
  page?: number;
  pageSize?: number;
}

export interface QueryResult<T> {
  records: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
