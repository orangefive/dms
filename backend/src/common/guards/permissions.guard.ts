import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ALL_PERMISSIONS } from '../permissions';
import { AuthContext } from '../types/auth-context';

/**
 * 全局权限守卫：
 * - 路由无 @Permissions 元数据 → 仅要求已认证
 * - API Key 认证 → 校验 Key 的 scopes
 * - 用户认证 → 从数据库读取角色权限校验（ADMIN 拥有全部权限）
 * 前端隐藏按钮只是 UI 优化，真正的安全校验在此处完成。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ auth?: AuthContext }>();
    const auth = request.auth;
    if (!auth) {
      throw new ForbiddenException('无访问权限');
    }

    if (auth.type === 'apiKey') {
      this.assertScopes(auth.scopes, required);
      return true;
    }

    const permissions = await this.loadUserPermissions(auth.id);
    if (permissions.includes('*')) {
      return true;
    }
    const missing = required.filter((p) => !permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`无访问权限（缺少: ${missing.join(', ')}）`);
    }
    return true;
  }

  private assertScopes(scopes: string[], required: string[]): void {
    if (scopes.includes('*')) {
      return;
    }
    const missing = required.filter((p) => !scopes.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`API Key 无此权限（缺少: ${missing.join(', ')}）`);
    }
  }

  private async loadUserPermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, roles: { select: { role: { select: { permissions: true } } } } },
    });
    if (!user || !user.isActive) {
      throw new ForbiddenException('账号不存在或已被禁用');
    }
    const merged = new Set<string>();
    for (const ur of user.roles) {
      const perms = (ur.role.permissions ?? []) as unknown;
      if (Array.isArray(perms)) {
        for (const p of perms) {
          if (typeof p === 'string') {
            merged.add(p);
          }
        }
      }
    }
    // 防御：权限编码必须来自目录，避免数据库被篡改后任意放行
    const valid = new Set<string>(ALL_PERMISSIONS);
    return [...merged].filter((p) => p === '*' || valid.has(p));
  }
}
