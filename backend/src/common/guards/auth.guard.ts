import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthContext } from '../types/auth-context';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AppError } from '../errors/app-error';
import { AppConfig } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { loadUserAuthState } from '../permissions.loader';

interface JwtPayload {
  sub: string;
  username: string;
  roles?: string[];
}

/**
 * 全局认证守卫：
 * - @Public() 路由跳过认证
 * - Authorization: Bearer dms_xxx → API Key 认证（n8n / 自动化脚本）
 * - Authorization: Bearer <jwt> → 网页用户 JWT 认证
 *
 * JWT 校验通过后仍会查询数据库确认账号存在且启用，
 * 并把实时角色/权限写入请求上下文，供 PermissionsGuard 使用。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly apiKeysService: ApiKeysService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      auth?: AuthContext;
    }>();
    const header = request.headers.authorization;
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少认证凭证，请携带 Authorization: Bearer <token>');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('认证凭证为空');
    }

    if (token.startsWith('dms_')) {
      request.auth = await this.authenticateApiKey(token);
    } else {
      request.auth = await this.authenticateJwt(token);
    }
    return true;
  }

  private async authenticateJwt(token: string): Promise<AuthContext> {
    const cfg = this.configService.get<AppConfig>('app');
    if (!cfg) {
      throw new Error('应用配置缺失');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: cfg.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException('登录已过期或凭证无效，请重新登录');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('登录已过期或凭证无效，请重新登录');
    }

    const state = await loadUserAuthState(this.prisma, payload.sub);
    if (!state) {
      throw new UnauthorizedException('账号不存在，请重新登录');
    }
    if (!state.isActive) {
      throw new UnauthorizedException('账号已被禁用，请联系管理员');
    }

    return {
      type: 'user',
      id: state.id,
      username: state.username,
      roleCodes: state.roleCodes,
      permissions: state.permissions,
    };
  }

  private async authenticateApiKey(token: string): Promise<AuthContext> {
    let key;
    try {
      key = await this.apiKeysService.verifyAndTouch(token);
    } catch (err) {
      if (err instanceof AppError) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }
    return {
      type: 'apiKey',
      keyId: key.id,
      name: key.name,
      scopes: key.scopes,
    };
  }
}
