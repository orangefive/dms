/** 全站统一的标量输入校验（写入与查询共用，避免规则漂移） */

const NUMERIC_TEXT = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 数值：仅接受有限 number，或十进制/科学计数法字符串；拒绝 "0x10"、"Infinity"、空串 */
export function isNumericInput(value: unknown): value is number | string {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text !== '' && NUMERIC_TEXT.test(text) && Number.isFinite(Number(text));
  }
  return false;
}

/** 将合法数值输入转换为 number；非法输入返回 null */
export function toFiniteNumber(value: unknown): number | null {
  if (!isNumericInput(value)) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * 严格日期校验：
 * - 只接受 YYYY-MM-DD（showTime=false）
 * - showTime=true 时接受 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss
 * - 校验真实日历（拒绝 2026-02-31）与时间范围
 */
export function isValidDateString(value: string, showTime: boolean): boolean {
  const dateMatch = DATE_ONLY.exec(value);
  if (dateMatch) {
    return isValidCalendarDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
  }
  if (!showTime) {
    return false;
  }
  const dateTimeMatch = DATE_TIME.exec(value);
  if (!dateTimeMatch) {
    return false;
  }
  const [year, month, day, hour, minute, second] = dateTimeMatch.slice(1).map(Number);
  return (
    isValidCalendarDate(year, month, day) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** 日期字符串标准化为可排序格式（仅用于校验后的展示/存储，不改变用户输入） */
export function formatDateParts(year: number, month: number, day: number): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}
