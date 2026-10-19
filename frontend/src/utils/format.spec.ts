import { describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { confirmDanger, displayName, formatDateTime, formulaErrorText } from './format';

vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: vi.fn() },
}));

describe('displayName', () => {
  it('无用户时返回占位符', () => {
    expect(displayName(null)).toBe('-');
    expect(displayName(undefined)).toBe('-');
  });

  it('优先使用 displayName，缺失时回退 username', () => {
    expect(displayName({ username: 'alice', displayName: '爱丽丝' })).toBe('爱丽丝');
    expect(displayName({ username: 'alice', displayName: '' })).toBe('alice');
    expect(displayName({ username: 'alice' })).toBe('alice');
  });
});

describe('formatDateTime', () => {
  it('空值与非法值都返回占位符', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('')).toBe('-');
    expect(formatDateTime('not-a-date')).toBe('-');
    expect(formatDateTime(new Date('invalid'))).toBe('-');
  });

  it('按 YYYY-MM-DD HH:mm:ss 补零输出', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatDateTime(d)).toBe('2026-01-02 03:04:05');
    expect(formatDateTime(d.toISOString())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('formulaErrorText', () => {
  it('映射为 Excel 风格错误文本', () => {
    expect(formulaErrorText('FORMULA_DIVIDE_BY_ZERO')).toBe('#DIV/0!');
    expect(formulaErrorText('FORMULA_TYPE_ERROR')).toBe('#VALUE!');
    expect(formulaErrorText('FORMULA_FIELD_NOT_FOUND')).toBe('#REF!');
    expect(formulaErrorText('FORMULA_INVALID_FUNCTION')).toBe('#NAME?');
    expect(formulaErrorText('FORMULA_CIRCULAR_REFERENCE')).toBe('#CIRC!');
  });

  it('上游依赖错误与类型错误同样展示为 #VALUE!', () => {
    expect(formulaErrorText('FORMULA_DEPENDENCY_ERROR')).toBe('#VALUE!');
  });

  it('未知错误码兜底为 #ERROR!', () => {
    expect(formulaErrorText('SOMETHING_ELSE')).toBe('#ERROR!');
  });
});

describe('confirmDanger', () => {
  it('用户确认时返回 true', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never);
    await expect(confirmDanger('确认删除？')).resolves.toBe(true);
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      '确认删除？',
      '危险操作',
      expect.objectContaining({ type: 'warning' }),
    );
  });

  it('用户取消（Promise 被 reject）时返回 false 而不是抛出', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel');
    await expect(confirmDanger('确认删除？', '永久删除')).resolves.toBe(false);
  });
});
