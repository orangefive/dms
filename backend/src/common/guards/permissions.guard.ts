import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthContext } from '../types/auth-context';

/**
 * 全局权限守卫：
 * - 路由无 @Permissions 元数据 → 仅要求已认证
 * - API Key 认证 → 校验 Key 的 scopes
 * - 用户认证 → 使用 AuthGuard 从数据库加载的实时权限
 * 前端隐藏按钮只是 UI 优化，真正的安全校验在此处完成。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    const granted = auth.type === 'apiKey' ? auth.scopes : auth.permissions;
    if (granted.includes('*')) {
      return true;
    }
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        auth.type === 'apiKey'
          ? `API Key 无此权限（缺少: ${missing.join(', ')}）`
          : `无访问权限（缺少: ${missing.join(', ')}）`,
      );
    }
    return true;
  }
}
