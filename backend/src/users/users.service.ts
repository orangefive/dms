import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { RoleCode } from '../common/enums';
import * as bcrypt from 'bcryptjs';

export interface UserWithRoles {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ role: { code: string; name: string } }>;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(page: number, pageSize: number): Promise<{ users: UserWithRoles[]; total: number }> {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { roles: { include: { role: { select: { code: true, name: true } } } } },
      }),
      this.prisma.user.count(),
    ]);
    return { users: users.map(this.toUserWithRoles), total };
  }

  async create(params: {
    username: string;
    email: string;
    displayName: string;
    password: string;
    roleCodes: string[];
    operatorId: string;
  }): Promise<UserWithRoles> {
    if (!/^[A-Za-z0-9_.-]{2,64}$/.test(params.username)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '用户名只能包含字母、数字、_ . -，长度 2-64');
    }
    if (params.password.length < 8 || !/[A-Za-z]/.test(params.password) || !/[0-9]/.test(params.password)) {
      throw AppError.badRequest(ErrorCodes.PASSWORD_TOO_WEAK, '密码至少 8 位，且必须同时包含字母和数字');
    }
    const roles = await this.resolveRoles(params.roleCodes);
    const passwordHash = await bcrypt.hash(params.password, 10);
    try {
      const user = await this.prisma.user.create({
        data: {
          username: params.username,
          email: params.email.toLowerCase(),
          displayName: params.displayName,
          passwordHash,
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
        include: { roles: { include: { role: { select: { code: true, name: true } } } } },
      });
      await this.audit.record({
        action: 'USER_CREATE',
        userId: params.operatorId,
        resourceType: 'user',
        resourceId: user.id,
        detail: { username: user.username, roles: roles.map((r) => r.code) },
      });
      return this.toUserWithRoles(user);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        const meta = (err as { meta?: { target?: string[] } }).meta;
        const field = meta?.target?.includes('username')
          ? '用户名'
          : meta?.target?.includes('email')
            ? '邮箱'
            : '字段';
        throw AppError.badRequest(
          field === '用户名' ? ErrorCodes.USERNAME_TAKEN : ErrorCodes.EMAIL_TAKEN,
          `${field}已被占用`,
        );
      }
      throw err;
    }
  }

  async update(
    userId: string,
    params: {
      displayName?: string;
      email?: string;
      isActive?: boolean;
      password?: string;
      roleCodes?: string[];
      operatorId: string;
    },
  ): Promise<UserWithRoles> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '用户不存在');
    }

    if (params.isActive === false && userId === params.operatorId) {
      throw AppError.badRequest(ErrorCodes.CANNOT_DISABLE_SELF, '不能禁用当前登录账号');
    }
    const newPasswordHash = params.password
      ? await bcrypt.hash(params.password, 10)
      : undefined;

    let roleLinks: Array<{ roleId: string }> | undefined;
    if (params.roleCodes) {
      const roles = await this.resolveRoles(params.roleCodes);
      const isAdmin = roles.some((r) => r.code === RoleCode.ADMIN);
      if (!isAdmin && (await this.isLastAdmin(existing.id, existing.roles))) {
        throw AppError.badRequest(
          ErrorCodes.LAST_ADMIN_PROTECTED,
          '系统至少需要保留一个管理员账号',
        );
      }
      roleLinks = roles.map((r) => ({ roleId: r.id }));
    }

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
            ...(params.email !== undefined ? { email: params.email.toLowerCase() } : {}),
            ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
            ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
          },
          include: { roles: { include: { role: { select: { code: true, name: true } } } } },
        });
        if (roleLinks) {
          await tx.userRole.deleteMany({ where: { userId } });
          await tx.userRole.createMany({ data: roleLinks.map((r) => ({ userId, roleId: r.roleId })) });
        }
        return updated;
      });
      await this.audit.record({
        action: 'USER_UPDATE',
        userId: params.operatorId,
        resourceType: 'user',
        resourceId: userId,
        detail: {
          username: existing.username,
          changed: {
            displayName: params.displayName !== undefined,
            email: params.email !== undefined,
            isActive: params.isActive !== undefined,
            password: newPasswordHash !== undefined,
            roles: roleLinks !== undefined,
          },
        },
      });
      return this.toUserWithRoles(user);
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw AppError.badRequest(ErrorCodes.EMAIL_TAKEN, '邮箱已被占用');
      }
      throw err;
    }
  }

  async remove(userId: string, operatorId: string): Promise<void> {
    if (userId === operatorId) {
      throw AppError.badRequest(ErrorCodes.CANNOT_DELETE_SELF, '不能删除当前登录账号');
    }
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '用户不存在');
    }
    if (await this.isLastAdmin(existing.id, existing.roles)) {
      throw AppError.badRequest(ErrorCodes.LAST_ADMIN_PROTECTED, '系统至少需要保留一个管理员账号');
    }
    await this.prisma.user.delete({ where: { id: userId } });
    await this.audit.record({
      action: 'USER_DELETE',
      userId: operatorId,
      resourceType: 'user',
      resourceId: userId,
      detail: { username: existing.username },
    });
  }

  /** 用户是否当前系统中的最后一个管理员 */
  private async isLastAdmin(
    userId: string,
    roles: Array<{ role: { code: string } }>,
  ): Promise<boolean> {
    const isAdmin = roles.some((r) => r.role.code === RoleCode.ADMIN);
    if (!isAdmin) {
      return false;
    }
    const adminCount = await this.prisma.user.count({
      where: { roles: { some: { role: { code: RoleCode.ADMIN } } } },
    });
    return adminCount <= 1;
  }

  private async resolveRoles(codes: string[]): Promise<Array<{ id: string; code: string }>> {
    if (codes.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '至少需要分配一个角色');
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: codes } } });
    const found = new Set(roles.map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw AppError.badRequest(ErrorCodes.NOT_FOUND, `角色不存在: ${missing.join(', ')}`);
    }
    return roles.map((r) => ({ id: r.id, code: r.code }));
  }

  private toUserWithRoles(u: {
    id: string;
    username: string;
    email: string;
    displayName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    roles: Array<{ role: { code: string; name: string } }>;
  }): UserWithRoles {
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.roles.map((r) => ({ role: { code: r.role.code, name: r.role.name } })),
    };
  }
}
