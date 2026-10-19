import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AuthUser } from '@/types';

vi.mock('@/api', () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('@/api/http', () => ({
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

import { authApi } from '@/api';
import { clearAccessToken, setAccessToken } from '@/api/http';
import { useAuthStore } from './auth';

function makeUser(roles: Array<{ code: string; permissions: string[] }>): AuthUser {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    displayName: '爱丽丝',
    isActive: true,
    lastLoginAt: null,
    roles: roles.map((r) => ({ code: r.code, name: r.code, permissions: r.permissions })),
  };
}

describe('auth store 权限判定', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('未登录时无任何权限', () => {
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(false);
    expect(store.permissions.size).toBe(0);
    expect(store.can('record:read')).toBe(false);
    expect(store.isAdmin).toBe(false);
  });

  it('ADMIN 的 * 通配符覆盖全部权限', () => {
    const store = useAuthStore();
    store.user = makeUser([{ code: 'ADMIN', permissions: ['*'] }]);
    expect(store.isAdmin).toBe(true);
    expect(store.can('record:read')).toBe(true);
    expect(store.can('user:delete', 'apikey:create')).toBe(true);
  });

  it('多权限判定要求全部满足', () => {
    const store = useAuthStore();
    store.user = makeUser([{ code: 'VIEWER', permissions: ['record:read'] }]);
    expect(store.can('record:read')).toBe(true);
    expect(store.can('record:read', 'record:write')).toBe(false);
    expect(store.isAdmin).toBe(false);
  });

  it('多角色权限取并集', () => {
    const store = useAuthStore();
    store.user = makeUser([
      { code: 'VIEWER', permissions: ['record:read'] },
      { code: 'DEVELOPER', permissions: ['table:write'] },
    ]);
    expect([...store.permissions].sort()).toEqual(['record:read', 'table:write']);
    expect(store.can('record:read', 'table:write')).toBe(true);
    expect(store.roleCodes).toEqual(['VIEWER', 'DEVELOPER']);
  });
});

describe('auth store 会话生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('登录成功后写入 access token 与用户信息', async () => {
    const store = useAuthStore();
    const user = makeUser([{ code: 'ADMIN', permissions: ['*'] }]);
    vi.mocked(authApi.login).mockResolvedValueOnce({ accessToken: 'tk', user });

    await store.login('alice', 'secret');

    expect(authApi.login).toHaveBeenCalledWith('alice', 'secret');
    expect(setAccessToken).toHaveBeenCalledWith('tk');
    expect(store.user).toEqual(user);
    expect(store.isLoggedIn).toBe(true);
  });

  it('bootstrap 成功时恢复会话并标记 ready', async () => {
    const store = useAuthStore();
    const user = makeUser([{ code: 'VIEWER', permissions: ['record:read'] }]);
    vi.mocked(authApi.refresh).mockResolvedValueOnce({ accessToken: 'tk2', user });

    await store.bootstrap();

    expect(setAccessToken).toHaveBeenCalledWith('tk2');
    expect(store.user).toEqual(user);
    expect(store.ready).toBe(true);
  });

  it('bootstrap 失败时清空本地状态且不抛出（刷新令牌过期的正常路径）', async () => {
    const store = useAuthStore();
    vi.mocked(authApi.refresh).mockRejectedValueOnce(new Error('401'));

    await expect(store.bootstrap()).resolves.toBeUndefined();

    expect(clearAccessToken).toHaveBeenCalled();
    expect(store.user).toBeNull();
    expect(store.ready).toBe(true);
  });

  it('登出接口失败也要清空本地会话', async () => {
    const store = useAuthStore();
    store.user = makeUser([{ code: 'ADMIN', permissions: ['*'] }]);
    vi.mocked(authApi.logout).mockRejectedValueOnce(new Error('network'));

    await store.logout();

    expect(clearAccessToken).toHaveBeenCalled();
    expect(store.user).toBeNull();
  });
});
