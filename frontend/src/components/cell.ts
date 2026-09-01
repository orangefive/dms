import type { DataField, RecordRow } from '@/types';
import { formulaErrorText } from '@/utils/format';

/** 单元格显示值（根据字段类型格式化） */
export function cellText(field: DataField, row: RecordRow): { text: string; isError: boolean } {
  const raw = row.data?.[field.fieldKey];
  const errorCode = row.formulaErrors?.[field.fieldKey];
  if (errorCode) {
    return { text: formulaErrorText(errorCode), isError: true };
  }
  if (raw === null || raw === undefined) {
    return { text: '', isError: false };
  }
  if (field.fieldType === 'MULTI_SELECT' && Array.isArray(raw)) {
    const options = field.config?.options ?? [];
    const labels = raw.map((v) => options.find((o) => o.value === v)?.label ?? String(v));
    return { text: labels.join(', '), isError: false };
  }
  if (field.fieldType === 'SINGLE_SELECT' && typeof raw === 'string') {
    const option = field.config?.options?.find((o) => o.value === raw);
    return { text: option?.label ?? raw, isError: false };
  }
  if (typeof raw === 'boolean') {
    return { text: raw ? 'true' : 'false', isError: false };
  }
  return { text: String(raw), isError: false };
}

/** 字段是否可排序 */
export function isSortable(field: DataField): boolean {
  return field.fieldType !== 'MULTI_SELECT';
}

/** 字段是否可筛选（操作符白名单按类型） */
export function operatorsForType(field: DataField): string[] {
  switch (field.fieldType) {
    case 'STRING':
    case 'SINGLE_LINE_TEXT':
      return ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'];
    case 'MULTI_LINE_TEXT':
      return ['eq', 'neq', 'contains', 'not_contains', 'is_null', 'is_not_null'];
    case 'NUMBER':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    case 'DATE':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    case 'SINGLE_SELECT':
      return ['eq', 'neq', 'is_null', 'is_not_null'];
    case 'MULTI_SELECT':
      return ['contains', 'not_contains', 'is_null', 'is_not_null'];
    case 'FORMULA':
      return field.formulaResultType === 'BOOLEAN'
        ? ['eq', 'neq']
        : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    default:
      return ['eq'];
  }
}

/** 操作符中文名 */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: '精确等于',
  neq: '不等于',
  contains: '包含',
  not_contains: '不包含',
  starts_with: '开头是',
  ends_with: '结尾是',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  is_null: '为空',
  is_not_null: '不为空',
};
