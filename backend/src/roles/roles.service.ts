import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { ALL_PERMISSIONS } from '../common/permissions';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<unknown[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
      isSystem: r.isSystem,
      userCount: r._count.users,
    }));
  }

  async create(params: {
    code: string;
    name: string;
    description?: string;
    permissions: string[];
  }): Promise<unknown> {
    this.assertPermissions(params.permissions);
    const code = params.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,64}$/.test(code)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '角色编码只能包含大写字母、数字、下划线');
    }
    const existing = await this.prisma.role.findUnique({ where: { code } });
    if (existing) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, `角色编码 ${code} 已存在`);
    }
    return this.prisma.role.create({
      data: {
        code,
        name: params.name,
        description: params.description ?? null,
        permissions: params.permissions as unknown as object,
        isSystem: false,
      },
    });
  }

  async update(
    roleId: string,
    params: { name?: string; description?: string; permissions?: string[] },
  ): Promise<unknown> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '角色不存在');
    }
    if (role.isSystem) {
      throw AppError.badRequest(ErrorCodes.SYSTEM_ROLE_PROTECTED, '系统内置角色不允许修改');
    }
    if (params.permissions) {
      this.assertPermissions(params.permissions);
    }
    return this.prisma.role.update({
      where: { id: roleId },
      data: {
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.permissions !== undefined
          ? { permissions: params.permissions as unknown as object }
          : {}),
      },
    });
  }

  async remove(roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, '角色不存在');
    }
    if (role.isSystem) {
      throw AppError.badRequest(ErrorCodes.SYSTEM_ROLE_PROTECTED, '系统内置角色不允许删除');
    }
    if (role._count.users > 0) {
      throw AppError.badRequest(ErrorCodes.ROLE_IN_USE, `角色仍被 ${role._count.users} 个用户使用，无法删除`);
    }
    await this.prisma.role.delete({ where: { id: roleId } });
  }

  private assertPermissions(permissions: string[]): void {
    const valid = new Set(ALL_PERMISSIONS);
    const invalid = permissions.filter((p) => !valid.has(p));
    if (invalid.length > 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, `权限编码非法: ${invalid.join(', ')}`);
    }
  }
}
