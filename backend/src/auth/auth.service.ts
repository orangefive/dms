import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, parseDuration } from '../config/env.validation';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { AuditService } from '../audit/audit.service';
import { getRequestContext } from '../common/request-context';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

export interface AuthUserInfo {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  roles: Array<{ code: string; name: string; permissions: string[] }>;
}

export interface LoginResult {
  user: AuthUserInfo;
  accessToken: string;
  refreshToken: string;
}

const REFRESH_COOKIE = 'dms_refresh';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(identifier: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
      },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      await this.auditFailedLogin(identifier);
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.auditFailedLogin(identifier);
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    if (!user.isActive) {
      throw AppError.unauthorized(ErrorCodes.USER_DISABLED, '账号已被禁用，请联系管理员');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const userInfo = this.toUserInfo(user);
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);

    await this.audit.record({ action: 'LOGIN', userId: user.id, detail: { username: user.username } });
    return { user: userInfo, accessToken, refreshToken };
  }

  /**
   * Refresh Token 轮换：
   * - 使用带条件的 updateMany 原子消费旧 Token，避免并发刷新重复签发会话
   * - 已消费的 Token 再次出现 → 视为重放，撤销该用户全部 Refresh Token
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const hash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!record) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 无效或已注销');
    }
    if (record.expiresAt <= new Date()) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 已过期');
    }
    if (record.revokedAt) {
      // 已消费的 Token 再次出现：可能是并发刷新（同一个 Cookie 被两个请求同时使用），
      // 也可能是泄漏的旧 Token 被重放。
      // 30 秒内视为并发竞争，只拒绝本次请求；超过 30 秒视为重放，撤销该用户全部会话。
      const revokedAgeMs = Date.now() - record.revokedAt.getTime();
      if (revokedAgeMs > 30_000) {
        await this.revokeAllRefreshTokens(record.userId);
      }
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 已失效，请重新登录');
    }

    const now = new Date();
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (consumed.count !== 1) {
      // 另一个并发请求先消费了该 Token；不要撤销胜出请求刚签发的新 Token
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 已失效，请重新登录');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) {
      await this.revokeAllRefreshTokens(record.userId);
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, '账号不存在或已被禁用');
    }

    const accessToken = await this.signAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(user.id);
    return { user: this.toUserInfo(user), accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const hash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (record) {
      await this.prisma.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({ action: 'LOGOUT', userId: record.userId });
    }
  }

  async me(userId: string): Promise<AuthUserInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '用户不存在');
    }
    if (!user.isActive) {
      throw AppError.unauthorized(ErrorCodes.USER_DISABLED, '账号已被禁用，请联系管理员');
    }
    return this.toUserInfo(user);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '用户不存在');
    }
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) {
      throw AppError.badRequest(ErrorCodes.PASSWORD_INCORRECT, '原密码不正确');
    }
    assertPasswordStrength(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({ action: 'PASSWORD_CHANGE', userId });
  }

  // ---- 内部 ----

  private get cfg(): AppConfig {
    const cfg = this.configService.get<AppConfig>('app');
    if (!cfg) {
      throw new Error('应用配置缺失');
    }
    return cfg;
  }

  private async signAccessToken(user: {
    id: string;
    username: string;
    roles: Array<{ role: { code: string } }>;
  }): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        roles: user.roles.map((r) => r.role.code),
      },
      { secret: this.cfg.jwtSecret, expiresIn: parseDuration(this.cfg.jwtExpiresIn) },
    );
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const ttlMs = parseDuration(this.cfg.jwtRefreshExpiresIn);
    const ctx = getRequestContext();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return token;
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(`${this.cfg.jwtRefreshSecret}:${token}`).digest('hex');
  }

  private async auditFailedLogin(identifier: string): Promise<void> {
    const ctx = getRequestContext();
    await this.audit.record({
      action: 'LOGIN_FAILED',
      detail: {
        identifier: identifier.slice(0, 128),
        ip: ctx.ip ?? null,
      },
    });
  }

  private toUserInfo(user: {
    id: string;
    username: string;
    email: string;
    displayName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    roles: Array<{ role: { code: string; name: string; permissions: unknown } }>;
  }): AuthUserInfo {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      roles: user.roles.map((r) => ({
        code: r.role.code,
        name: r.role.name,
        permissions: Array.isArray(r.role.permissions)
          ? (r.role.permissions as string[])
          : [],
      })),
    };
  }

  static readonly REFRESH_COOKIE = REFRESH_COOKIE;
}

/** 密码强度规则：至少 8 位，同时包含字母和数字（全站统一） */
export function assertPasswordStrength(password: string): void {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw AppError.badRequest(
      ErrorCodes.PASSWORD_TOO_WEAK,
      '密码至少 8 位，且必须同时包含字母和数字',
    );
  }
}
