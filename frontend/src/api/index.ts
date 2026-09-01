import { api } from './http';
import type {
  ApiKeyItem,
  AuditLogItem,
  AuthUser,
  DataField,
  DataTableItem,
  ExternalColumn,
  ExternalTableMeta,
  Pagination,
  Project,
  QueryPayload,
  QueryResult,
  QuerySort,
  RecordRow,
  RoleInfo,
  UniqueConstraintItem,
  UserInfo,
} from '@/types';

// ==================== Auth ====================

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
}

export const authApi = {
  login: (username: string, password: string) =>
    api<LoginResult>({ url: '/auth/login', method: 'POST', data: { username, password } }),
  refresh: () => api<LoginResult>({ url: '/auth/refresh', method: 'POST' }),
  logout: () => api<{ loggedOut: boolean }>({ url: '/auth/logout', method: 'POST' }),
  me: () => api<AuthUser>({ url: '/auth/me', method: 'GET' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    api<{ changed: boolean }>({
      url: '/auth/change-password',
      method: 'POST',
      data: { oldPassword, newPassword },
    }),
};

// ==================== Projects ====================

export const projectApi = {
  list: (withTables = false) =>
    api<Project[]>({ url: '/projects', method: 'GET', params: { withTables } }),
  get: (id: string) => api<Project>({ url: `/projects/${id}`, method: 'GET' }),
  create: (data: { name: string; description?: string }) =>
    api<Project>({ url: '/projects', method: 'POST', data }),
  update: (id: string, data: { name?: string; description?: string }) =>
    api<Project>({ url: `/projects/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/projects/${id}`, method: 'DELETE' }),
};

// ==================== Tables ====================

export const tableApi = {
  list: (projectId?: string) =>
    api<DataTableItem[]>({ url: '/tables', method: 'GET', params: { projectId } }),
  get: (id: string) => api<DataTableItem>({ url: `/tables/${id}`, method: 'GET' }),
  create: (projectId: string, data: { name: string; description?: string; tableType: 'SYSTEM' | 'EXTERNAL'; externalTableName?: string }) =>
    api<DataTableItem>({ url: `/projects/${projectId}/tables`, method: 'POST', data }),
  update: (id: string, data: { name?: string; description?: string }) =>
    api<DataTableItem>({ url: `/tables/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/tables/${id}`, method: 'DELETE' }),
};

// ==================== Fields ====================

export interface FieldPayload {
  name: string;
  fieldKey?: string;
  fieldType: string;
  config?: Record<string, unknown>;
  isUnique?: boolean;
  isIndexed?: boolean;
  formulaExpression?: string;
}

export const fieldApi = {
  list: (tableId: string) => api<DataField[]>({ url: `/tables/${tableId}/fields`, method: 'GET' }),
  create: (tableId: string, data: FieldPayload) =>
    api<DataField>({ url: `/tables/${tableId}/fields`, method: 'POST', data }),
  update: (id: string, data: Partial<FieldPayload>) =>
    api<DataField>({ url: `/fields/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/fields/${id}`, method: 'DELETE' }),
  reorder: (tableId: string, orderedIds: string[]) =>
    api<{ reordered: boolean }>({
      url: `/tables/${tableId}/fields/reorder`,
      method: 'PUT',
      data: { orderedIds },
    }),
  listConstraints: (tableId: string) =>
    api<UniqueConstraintItem[]>({ url: `/tables/${tableId}/constraints`, method: 'GET' }),
  createConstraint: (tableId: string, name: string, fields: string[]) =>
    api<UniqueConstraintItem>({
      url: `/tables/${tableId}/constraints`,
      method: 'POST',
      data: { name, fields },
    }),
  removeConstraint: (id: string) =>
    api<{ deleted: boolean }>({ url: `/constraints/${id}`, method: 'DELETE' }),
};

// ==================== Records ====================

export const recordApi = {
  query: (tableId: string, payload: QueryPayload) =>
    api<QueryResult>({ url: `/tables/${tableId}/records/query`, method: 'POST', data: payload }),
  list: (tableId: string, params: { page?: number; pageSize?: number; sortField?: string; sortOrder?: string }) =>
    api<QueryResult>({ url: `/tables/${tableId}/records`, method: 'GET', params }),
  get: (tableId: string, recordId: string) =>
    api<{ record: RecordRow }>({ url: `/tables/${tableId}/records/${recordId}`, method: 'GET' }),
  create: (tableId: string, data: Record<string, unknown>) =>
    api<{ id: string; data: Record<string, unknown> }>({
      url: `/tables/${tableId}/records`,
      method: 'POST',
      data: { data },
    }),
  update: (tableId: string, recordId: string, data: Record<string, unknown>) =>
    api<{ id: string; data: Record<string, unknown> }>({
      url: `/tables/${tableId}/records/${recordId}`,
      method: 'PATCH',
      data: { data },
    }),
  remove: (tableId: string, recordId: string) =>
    api<{ deleted: boolean }>({ url: `/tables/${tableId}/records/${recordId}`, method: 'DELETE' }),
  batchDelete: (tableId: string, ids: string[]) =>
    api<{ deleted: number }>({
      url: `/tables/${tableId}/records/batch-delete`,
      method: 'POST',
      data: { ids },
    }),
  findOne: (tableId: string, field: string, value: unknown) =>
    api<{ record: RecordRow | null }>({
      url: `/tables/${tableId}/records/find-one`,
      method: 'POST',
      data: { field, value },
    }),
  batch: (tableId: string, records: Array<Record<string, unknown>>) =>
    api<{ created: number }>({ url: `/tables/${tableId}/records/batch`, method: 'POST', data: { records } }),
  upsert: (tableId: string, match: Record<string, unknown>, data: Record<string, unknown>) =>
    api<{ mode: 'insert' | 'update'; record: { id: string } }>({
      url: `/tables/${tableId}/records/upsert`,
      method: 'POST',
      data: { match, data },
    }),
};

// ==================== Formula ====================

export const formulaApi = {
  validate: (tableId: string, expression: string, fieldId?: string) =>
    api<{ valid: boolean; normalized?: string; resultType?: string; error?: { code: string; message: string } }>({
      url: `/tables/${tableId}/formula/validate`,
      method: 'POST',
      data: { expression, fieldId },
    }),
  recalculate: (tableId: string, fieldId?: string) =>
    api<{ total: number; processed: number; failed: number }>({
      url: `/tables/${tableId}/formula/recalculate`,
      method: 'POST',
      data: { fieldId },
    }),
};

// ==================== Users / Roles ====================

export const userApi = {
  list: (params: { page?: number; pageSize?: number } = {}) =>
    api<{ users: UserInfo[]; pagination: Pagination }>({ url: '/users', method: 'GET', params }),
  create: (data: { username: string; email: string; displayName: string; password: string; roleCodes: string[] }) =>
    api<UserInfo>({ url: '/users', method: 'POST', data }),
  update: (id: string, data: { displayName?: string; email?: string; isActive?: boolean; password?: string; roleCodes?: string[] }) =>
    api<UserInfo>({ url: `/users/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/users/${id}`, method: 'DELETE' }),
};

export const roleApi = {
  list: () => api<RoleInfo[]>({ url: '/roles', method: 'GET' }),
  create: (data: { code: string; name: string; description?: string; permissions: string[] }) =>
    api<RoleInfo>({ url: '/roles', method: 'POST', data }),
  update: (id: string, data: { name?: string; description?: string; permissions?: string[] }) =>
    api<RoleInfo>({ url: `/roles/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/roles/${id}`, method: 'DELETE' }),
};

// ==================== API Keys ====================

export const apiKeyApi = {
  list: () => api<ApiKeyItem[]>({ url: '/api-keys', method: 'GET' }),
  create: (data: { name: string; scopes?: string[]; expiresAt?: string }) =>
    api<ApiKeyItem & { key: string }>({ url: '/api-keys', method: 'POST', data }),
  update: (id: string, data: { name?: string; isActive?: boolean; scopes?: string[]; expiresAt?: string | null }) =>
    api<ApiKeyItem>({ url: `/api-keys/${id}`, method: 'PATCH', data }),
  remove: (id: string) => api<{ deleted: boolean }>({ url: `/api-keys/${id}`, method: 'DELETE' }),
};

// ==================== Audit ====================

export const auditApi = {
  list: (params: { action?: string; resourceType?: string; page?: number; pageSize?: number }) =>
    api<{ logs: AuditLogItem[]; pagination: Pagination }>({ url: '/audit-logs', method: 'GET', params }),
};

// ==================== External ====================

export const externalApi = {
  listTables: () => api<ExternalTableMeta[]>({ url: '/external/tables', method: 'GET' }),
  getColumns: (tableName: string) =>
    api<{ name: string; comment: string; columns: ExternalColumn[] }>({
      url: `/external/tables/${tableName}/columns`,
      method: 'GET',
    }),
};

// ==================== Excel 导入 ====================

export interface ImportRowError {
  row: number;
  code: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  totalRows: number;
  skippedColumns: string[];
  errors: ImportRowError[];
}

export const importApi = {
  upload: (tableId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api<ImportResult>({
      url: `/tables/${tableId}/records/import`,
      method: 'POST',
      data: formData,
    });
  },
  downloadTemplate: async (tableId: string) => {
    const { apiBlob } = await import('./http');
    return apiBlob({ url: `/tables/${tableId}/records/import/template`, method: 'GET' });
  },
};

// ==================== 导出 ====================

export async function exportRecords(
  tableId: string,
  payload: QueryPayload,
): Promise<{ blob: Blob; filename: string }> {
  const { apiBlob } = await import('./http');
  return apiBlob({ url: `/tables/${tableId}/records/export`, method: 'POST', data: payload });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type { QuerySort };
