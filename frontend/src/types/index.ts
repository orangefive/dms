/** 与后端一致的领域类型 */

export type FieldType =
  | 'STRING'
  | 'SINGLE_LINE_TEXT'
  | 'MULTI_LINE_TEXT'
  | 'NUMBER'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'DATE'
  | 'FORMULA';

export interface SelectOption {
  label: string;
  value: string;
}

export interface FieldConfig {
  options?: SelectOption[];
  showTime?: boolean;
  maxLength?: number;
}

export interface DataField {
  id: string;
  tableId: string;
  name: string;
  fieldKey: string;
  fieldType: FieldType;
  config: FieldConfig | null;
  sortOrder: number;
  isUnique: boolean;
  isIndexed: boolean;
  formulaExpression?: string | null;
  formulaAst?: unknown;
  formulaResultType?: 'NUMBER' | 'BOOLEAN' | null;
  formulaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tables?: DataTableItem[];
  _count?: { tables: number };
}

export interface DataTableItem {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  tableType: 'SYSTEM' | 'EXTERNAL';
  externalTableName: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  _count?: { fields: number; records: number };
}

export interface RecordRow {
  id?: string;
  data: Record<string, unknown>;
  formulaErrors?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface QueryResult {
  records: RecordRow[];
  pagination: Pagination;
}

export type QueryOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export interface QueryFilter {
  field: string;
  operator: QueryOperator;
  value?: unknown;
}

export interface QuerySort {
  field: string;
  order: 'asc' | 'desc';
}

export interface QueryPayload {
  filters?: QueryFilter[];
  logic?: 'AND';
  sort?: QuerySort[];
  page?: number;
  pageSize?: number;
}

export interface RoleInfo {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount?: number;
}

export interface UserInfo {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: Array<{ role: { code: string; name: string } }>;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: Array<{ code: string; name: string; permissions: string[] }>;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy?: { username: string; displayName: string };
}

export interface AuditLogItem {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  user?: { username: string; displayName: string } | null;
}

export interface UniqueConstraintItem {
  id: string;
  tableId: string;
  name: string;
  fields: string[];
  createdAt: string;
}

export interface ExternalTableMeta {
  name: string;
  comment: string;
  columnCount: number;
}

export interface ExternalColumn {
  name: string;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  columnKey: string;
  comment: string;
  ordinal: number;
}
