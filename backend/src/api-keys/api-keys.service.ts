import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/env.validation';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { createHash, randomBytes } from 'node:crypto';

export interface ApiKeyAuthResult {
  id: string;
  name: string;
  scopes: string[];
}

/** 默认权限范围：n8n / 自动化脚本所需的数据读写与查询能力 */
export const DEFAULT_API_KEY_SCOPES = [
  'project:read',
  'table:read',
  'field:read',
  'record:read',
  'record:write',
  'record:delete',
  'export',
];

/** 归一化权限范围：空数组 → 默认范围 */
export function normalizeScopes(scopes?: string[] | null): string[] {
  if (Array.isArray(scopes) && scopes.length > 0) {
    return scopes;
  }
  return [...DEFAULT_API_KEY_SCOPES];
}

/**
 * API Key 服务：
 * - 完整 Key 仅创建时返回一次
 * - 数据库只保存 SHA-256(key + pepper)
 * - 校验启用状态、过期时间，并更新 lastUsedAt
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** 生成完整 Key：dms_ + 48 字节随机数 */
  generateKey(): { key: string; keyHash: string; keyPrefix: string } {
    const raw = randomBytes(48).toString('base64url');
    const key = `dms_${raw}`;
    return {
      key,
      keyHash: this.hashKey(key),
      keyPrefix: key.slice(0, 12),
    };
  }

  /** 校验完整 Key 并返回认证上下文；更新最后使用时间 */
  async verifyAndTouch(key: string): Promise<ApiKeyAuthResult> {
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.hashKey(key) },
    });
    if (!record) {
      throw AppError.unauthorized(ErrorCodes.API_KEY_INVALID, 'API Key 无效');
    }
    if (!record.isActive) {
      throw AppError.unauthorized(ErrorCodes.API_KEY_DISABLED, 'API Key 已被禁用');
    }
    if (record.expiresAt && record.expiresAt < new Date()) {
      throw AppError.unauthorized(ErrorCodes.API_KEY_EXPIRED, 'API Key 已过期');
    }
    // 异步更新最后使用时间（不阻塞请求）
    void this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { id: record.id, name: record.name, scopes: normalizeScopes(record.scopes as string[] | null) };
  }

  private get cfg(): AppConfig {
    const cfg = this.configService.get<AppConfig>('app');
    if (!cfg) {
      throw new Error('应用配置缺失');
    }
    return cfg;
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(`${this.cfg.apiKeySecret}:${key}`).digest('hex');
  }
}
