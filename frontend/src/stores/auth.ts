import { defineStore } from 'pinia';
import { authApi } from '@/api';
import { clearAccessToken, setAccessToken } from '@/api/http';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    ready: false,
  }),
  getters: {
    isLoggedIn: (s) => Boolean(s.user),
    roleCodes: (s) => s.user?.roles.map((r) => r.code) ?? [],
    /** 展平后的权限集合（含 *） */
    permissions(state): Set<string> {
      const set = new Set<string>();
      for (const role of state.user?.roles ?? []) {
        for (const p of role.permissions) {
          set.add(p);
        }
      }
      return set;
    },
    isAdmin: (s) => s.user?.roles.some((r) => r.code === 'ADMIN') ?? false,
  },
  actions: {
    /** 权限判断：ADMIN 拥有全部权限 */
    can(...required: string[]): boolean {
      const perms = this.permissions;
      if (perms.has('*')) {
        return true;
      }
      return required.every((p) => perms.has(p));
    },
    async login(username: string, password: string): Promise<void> {
      const result = await authApi.login(username, password);
      setAccessToken(result.accessToken);
      this.user = result.user;
    },
    async fetchMe(): Promise<void> {
      this.user = await authApi.me();
    },
    /** 应用启动时尝试用 Refresh Token 恢复会话 */
    async bootstrap(): Promise<void> {
      try {
        const result = await authApi.refresh();
        setAccessToken(result.accessToken);
        this.user = result.user;
      } catch {
        clearAccessToken();
        this.user = null;
      } finally {
        this.ready = true;
      }
    },
    async logout(): Promise<void> {
      try {
        await authApi.logout();
      } catch {
        // 忽略登出接口错误
      }
      clearAccessToken();
      this.user = null;
    },
  },
});
