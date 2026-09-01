import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/env.validation';import { AppError } from '../common/errors/app-error';
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
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
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

  async refresh(refreshToken: string): Promise<LoginResult> {
    const hash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.revokedAt) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 无效或已注销');
    }
    if (record.expiresAt < new Date()) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, 'Refresh Token 已过期');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) {
      throw AppError.unauthorized(ErrorCodes.REFRESH_TOKEN_INVALID, '账号不存在或已被禁用');
    }

    // 轮换：旧 token 立即注销，签发新 token
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

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
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
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
    this.assertPasswordStrength(newPassword);
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

  private hashToken(token: string): string {
    return createHash('sha256').update(`${this.cfg.jwtRefreshSecret}:${token}`).digest('hex');
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

  private assertPasswordStrength(password: string): void {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw AppError.badRequest(
        ErrorCodes.PASSWORD_TOO_WEAK,
        '密码至少 8 位，且必须同时包含字母和数字',
      );
    }
  }

  static readonly REFRESH_COOKIE = REFRESH_COOKIE;
}

/** 解析 '7d' / '30m' / '1h' / '3600' 为毫秒 */
function parseDuration(value: string): number {
  const m = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!m) {
    return 7 * 24 * 3600 * 1000;
  }
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 3600 * 1000;
    case 'd':
      return n * 24 * 3600 * 1000;
    default:
      return n * 1000;
  }
}
