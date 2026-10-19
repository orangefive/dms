import { DataField } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FieldType } from '../common/enums';
import { isNumericInput, isValidDateString, toFiniteNumber } from '../common/validation';
import { QueryFilter, QueryOperator, QuerySort, QUERY_OPERATORS } from './query.types';

/** 各字段类型允许的操作符白名单（需求 §13） */
export const OPERATORS_BY_TYPE: Record<string, QueryOperator[]> = {
  STRING: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_null', 'is_not_null'],
  SINGLE_LINE_TEXT: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_null', 'is_not_null'],
  MULTI_LINE_TEXT: ['eq', 'neq', 'contains', 'not_contains', 'is_null', 'is_not_null'],
  NUMBER: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_null', 'is_not_null'],
  DATE: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
  SINGLE_SELECT: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
  MULTI_SELECT: ['contains', 'not_contains', 'is_null', 'is_not_null'],
  FORMULA: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
};

/** FORMULA 字段按结果类型细分（BOOLEAN 只允许 eq/neq） */
export function operatorsForField(field: DataField): QueryOperator[] {
  if (field.fieldType === FieldType.FORMULA) {
    if (field.formulaResultType === 'BOOLEAN') {
      return ['eq', 'neq'];
    }
    return OPERATORS_BY_TYPE.FORMULA;
  }
  return OPERATORS_BY_TYPE[field.fieldType] ?? [];
}

export function isNumericValue(v: unknown): v is number | string {
  return isNumericInput(v);
}

export function normalizeNumber(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === null) {
    throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, '需要有效的有限数值');
  }
  return n;
}

/**
 * 查询条件校验：
 * - 字段必须存在（FIELD_NOT_FOUND）
 * - 操作符必须在字段类型白名单内（INVALID_OPERATOR）
 * - 值必须通过类型/选项/日期校验（INVALID_VALUE）
 * - 禁止 contains 等模糊操作符用于定位类场景由调用方保证（find/find-one/upsert 只走 eq）
 */
export function validateFilter(filter: QueryFilter, field: DataField): void {
  const { operator, value } = filter;

  if (!QUERY_OPERATORS.includes(operator)) {
    throw AppError.badRequest(ErrorCodes.QUERY_INVALID_OPERATOR, `不支持的操作符 "${operator}"`);
  }
  const allowed = operatorsForField(field);
  if (!allowed.includes(operator)) {
    throw AppError.badRequest(
      ErrorCodes.QUERY_INVALID_OPERATOR,
      `操作符 "${operator}" 不适用于字段类型 ${field.fieldType}`,
    );
  }

  if (operator === 'is_null' || operator === 'is_not_null') {
    return;
  }
  if (value === undefined || value === null || value === '') {
    throw AppError.badRequest(
      ErrorCodes.QUERY_INVALID_VALUE,
      `操作符 "${operator}" 必须提供查询值`,
    );
  }

  const type = field.fieldType;
  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value)) {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, 'in / not_in 的值必须是数组');
    }
    if (value.length === 0) {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, 'in / not_in 的数组不能为空');
    }
    if (value.length > 100) {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, 'in / not_in 最多支持 100 个值');
    }
    for (const item of value) {
      validateScalarValue(item, type, field);
    }
    return;
  }
  validateScalarValue(value, type, field);
}

function validateScalarValue(value: unknown, type: string, field: DataField): void {
  if (type === FieldType.NUMBER || (type === FieldType.FORMULA && field.formulaResultType === 'NUMBER')) {
    if (!isNumericValue(value)) {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 需要数字类型的值`);
    }
    return;
  }
  if (type === FieldType.FORMULA) {
    // BOOLEAN 公式
    if (typeof value !== 'boolean') {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 需要布尔类型的值`);
    }
    return;
  }
  if (type === FieldType.DATE) {
    if (typeof value !== 'string') {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 需要日期字符串`);
    }
    const config = (field.config ?? {}) as { showTime?: boolean };
    if (!isValidDateString(value, Boolean(config.showTime))) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_VALUE,
        `字段 ${field.name} 的日期格式不正确（期望 ${config.showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'}）`,
      );
    }
    return;
  }
  if (type === FieldType.SINGLE_SELECT || type === FieldType.MULTI_SELECT) {
    const options = ((field.config ?? {}) as { options?: Array<{ label: string; value: string }> }).options ?? [];
    const allowedValues = new Set(options.map((o) => o.value));
    if (typeof value !== 'string') {
      throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 需要选项值字符串`);
    }
    if (!allowedValues.has(value)) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_VALUE,
        `字段 ${field.name} 的值 "${value}" 不在选项列表中`,
      );
    }
    return;
  }
  // 文本类
  if (typeof value !== 'string') {
    throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 需要字符串类型的值`);
  }
  if (type === FieldType.STRING && value.length > 1024) {
    throw AppError.badRequest(ErrorCodes.QUERY_INVALID_VALUE, `字段 ${field.name} 的值过长`);
  }
}

/** 校验排序字段 */
export function validateSort(sort: QuerySort, field: DataField): void {
  if (field.fieldType === FieldType.FORMULA && field.formulaResultType === 'BOOLEAN') {
    // 布尔公式允许排序（MySQL 布尔可排序）
    return;
  }
  if (field.fieldType === FieldType.MULTI_SELECT) {
    throw AppError.badRequest(ErrorCodes.QUERY_INVALID_OPERATOR, '多选字段不支持排序');
  }
}
