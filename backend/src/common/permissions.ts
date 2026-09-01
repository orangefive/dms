/** 权限目录：分组 + 编码 + 说明 */
export interface PermissionDef {
  code: string;
  label: string;
}

export interface PermissionGroup {
  group: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: 'project',
    label: '项目',
    permissions: [
      { code: 'project:read', label: '查看项目' },
      { code: 'project:write', label: '创建/编辑项目' },
      { code: 'project:delete', label: '删除项目' },
    ],
  },
  {
    group: 'table',
    label: '数据表',
    permissions: [
      { code: 'table:read', label: '查看数据表' },
      { code: 'table:write', label: '创建/编辑数据表（含 EXTERNAL 注册）' },
      { code: 'table:delete', label: '删除数据表' },
    ],
  },
  {
    group: 'field',
    label: '字段',
    permissions: [
      { code: 'field:read', label: '查看字段' },
      { code: 'field:write', label: '创建/编辑字段（含公式）' },
      { code: 'field:delete', label: '删除字段' },
    ],
  },
  {
    group: 'record',
    label: '数据',
    permissions: [
      { code: 'record:read', label: '查看/查询记录' },
      { code: 'record:write', label: '新增/修改/批量/导入记录' },
      { code: 'record:delete', label: '删除记录' },
    ],
  },
  {
    group: 'api-key',
    label: 'API 密钥',
    permissions: [
      { code: 'api-key:read', label: '查看 API 密钥' },
      { code: 'api-key:write', label: '创建/编辑 API 密钥' },
      { code: 'api-key:delete', label: '删除 API 密钥' },
    ],
  },
  {
    group: 'export',
    label: '导出',
    permissions: [{ code: 'export', label: 'Excel 导出' }],
  },
  {
    group: 'user',
    label: '用户管理',
    permissions: [
      { code: 'user:manage', label: '用户管理' },
      { code: 'role:manage', label: '角色管理' },
    ],
  },
  {
    group: 'audit',
    label: '审计',
    permissions: [{ code: 'audit:read', label: '查看审计日志' }],
  },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.code),
);

export const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
