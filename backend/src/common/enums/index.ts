/** 字段类型（禁止互转） */
export enum FieldType {
  STRING = 'STRING',
  SINGLE_LINE_TEXT = 'SINGLE_LINE_TEXT',
  MULTI_LINE_TEXT = 'MULTI_LINE_TEXT',
  NUMBER = 'NUMBER',
  SINGLE_SELECT = 'SINGLE_SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  FORMULA = 'FORMULA',
}

export const FIELD_TYPES = Object.values(FieldType) as string[];

/** 公式结果类型 */
export enum FormulaResultType {
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  // 预留：STRING / DATE
}

/** 表类型 */
export enum TableType {
  SYSTEM = 'SYSTEM',
  EXTERNAL = 'EXTERNAL',
}

export const TABLE_TYPES = Object.values(TableType) as string[];

/** 角色编码 */
export enum RoleCode {
  ADMIN = 'ADMIN',
  DEVELOPER = 'DEVELOPER',
  VIEWER = 'VIEWER',
}
