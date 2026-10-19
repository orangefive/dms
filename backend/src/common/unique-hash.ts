import { createHash } from 'node:crypto';

/**
 * 唯一约束值哈希：基于原始值（大小写敏感、类型敏感）。
 * 写入路径与历史回填路径必须使用同一算法，否则同一组合会被判为不同值。
 */
export function hashUniqueValues(values: Record<string, unknown>): string {
  const canonical = Object.keys(values)
    .sort()
    .map((k) => `${k}=${JSON.stringify(values[k])}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * 从记录 data 中提取唯一约束需要的字段值。
 * 任一字段为空 → 返回 null（与 MySQL NULL 语义一致：唯一索引不约束 NULL）。
 */
export function extractUniqueValues(
  data: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    const value = data[key];
    if (value === null || value === undefined) {
      return null;
    }
    values[key] = value;
  }
  return values;
}
