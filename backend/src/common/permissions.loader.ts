import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSIONS_SET } from './permissions';

export interface UserAuthState {
  id: string;
  username: string;
  isActive: boolean;
  roleCodes: string[];
  permissions: string[];
}

/**
 * 从数据库加载用户当前的认证状态（角色 + 权限 + 启用状态）。
 *
 * Access Token 只用于证明“这个请求来自已登录用户”，
 * 角色和权限一律以数据库为准，避免账号被禁用或角色被降级后，
 * 旧 Token 在有效期内仍保留原有权限。
 */
export async function loadUserAuthState(
  prisma: PrismaService,
  userId: string,
): Promise<UserAuthState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      isActive: true,
      roles: {
        select: { role: { select: { code: true, permissions: true } } },
      },
    },
  });
  if (!user) {
    return null;
  }

  const roleCodes: string[] = [];
  const merged = new Set<string>();
  for (const link of user.roles) {
    roleCodes.push(link.role.code);
    const perms = link.role.permissions;
    if (!Array.isArray(perms)) {
      continue;
    }
    for (const p of perms) {
      if (typeof p !== 'string') {
        continue;
      }
      // 权限编码必须来自目录，避免数据库被篡改后任意放行
      if (p === '*' || ALL_PERMISSIONS_SET.has(p)) {
        merged.add(p);
      }
    }
  }

  return {
    id: user.id,
    username: user.username,
    isActive: user.isActive,
    roleCodes,
    permissions: [...merged],
  };
}
