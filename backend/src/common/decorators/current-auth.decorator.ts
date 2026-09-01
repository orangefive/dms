import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext } from '../types/auth-context';

/** 获取当前请求认证上下文（用户或 API Key） */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | null => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    return request.auth ?? null;
  },
);

/** 获取当前用户（仅用户认证时非空） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    return request.auth?.type === 'user' ? request.auth : null;
  },
);
