import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestContext } from '../common/request-context';

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'PROJECT_CREATE'
  | 'PROJECT_UPDATE'
  | 'PROJECT_DELETE'
  | 'TABLE_CREATE'
  | 'TABLE_UPDATE'
  | 'TABLE_DELETE'
  | 'FIELD_CREATE'
  | 'FIELD_UPDATE'
  | 'FIELD_DELETE'
  | 'RECORD_CREATE'
  | 'RECORD_UPDATE'
  | 'RECORD_DELETE'
  | 'RECORD_BATCH_CREATE'
  | 'RECORD_BATCH_DELETE'
  | 'RECORD_UPSERT'
  | 'API_KEY_CREATE'
  | 'API_KEY_UPDATE'
  | 'API_KEY_DELETE';

export interface AuditDetail {
  [key: string]: unknown;
}

/**
 * 审计日志服务：写入 action + 资源 + IP/UA（来自请求上下文）。
 * 异步写入，不阻塞业务主流程。
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    action: AuditAction;
    userId?: string | null;
    resourceType?: string;
    resourceId?: string;
    detail?: AuditDetail;
  }): Promise<void> {
    const ctx = getRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: params.userId ?? null,
          action: params.action,
          resourceType: params.resourceType ?? null,
          resourceId: params.resourceId ?? null,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          detail: params.detail ? (params.detail as object) : Prisma.DbNull,
        },
      });
    } catch (err) {
      // 审计失败不影响业务
      console.error('[audit] 写入审计日志失败:', err);
    }
  }
}
