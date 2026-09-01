import { ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';

/** 供全站使用的通用工具 */

/** 显示名称或用户名 */
export function displayName(user?: { username: string; displayName?: string } | null): string {
  if (!user) {
    return '-';
  }
  return user.displayName || user.username;
}

/** 日期时间格式化 */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) {
    return '-';
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    return '-';
  }
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 公式错误码 → 展示文本 */
export function formulaErrorText(code: string): string {
  switch (code) {
    case 'FORMULA_DIVIDE_BY_ZERO':
      return '#DIV/0!';
    case 'FORMULA_TYPE_ERROR':
      return '#VALUE!';
    case 'FORMULA_FIELD_NOT_FOUND':
      return '#REF!';
    case 'FORMULA_INVALID_FUNCTION':
      return '#NAME?';
    case 'FORMULA_INVALID_ARGUMENT':
      return '#N/A';
    case 'FORMULA_CIRCULAR_REFERENCE':
      return '#CIRC!';
    case 'FORMULA_SYNTAX_ERROR':
      return '#ERROR!';
    default:
      return '#ERROR!';
  }
}

/** 二次确认（重要资源输入名称） */
export async function confirmDanger(
  message: string,
  confirmText = '删除',
): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, '危险操作', {
      confirmButtonText: confirmText,
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    });
    return true;
  } catch {
    return false;
  }
}

/** 登录后跳转 */
export function usePostLoginRedirect(): () => void {
  const router = useRouter();
  const route = router.currentRoute.value;
  return () => {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/projects';
    void router.replace(redirect);
  };
}
