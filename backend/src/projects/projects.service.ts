import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeTables = false) {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: includeTables
        ? { tables: { orderBy: { createdAt: 'asc' }, include: { _count: { select: { fields: true, records: true } } } } }
        : { _count: { select: { tables: true } } },
    });
  }

  async create(params: { name: string; description?: string; operatorId: string; operatorName: string }) {
    const project = await this.prisma.project.create({
      data: {
        name: params.name.trim(),
        description: params.description ?? null,
        createdBy: params.operatorId,
      },
    });
    await this.audit.record({
      action: 'PROJECT_CREATE',
      userId: params.operatorId,
      resourceType: 'project',
      resourceId: project.id,
      detail: { name: project.name, by: params.operatorName },
    });
    return project;
  }

  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        tables: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { fields: true, records: true } } },
        },
      },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, '项目不存在');
    }
    return project;
  }

  async update(
    id: string,
    params: { name?: string; description?: string; operatorId: string; operatorName: string },
  ) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, '项目不存在');
    }
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(params.name !== undefined ? { name: params.name.trim() } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
      },
    });
    await this.audit.record({
      action: 'PROJECT_UPDATE',
      userId: params.operatorId,
      resourceType: 'project',
      resourceId: id,
      detail: { name: project.name, by: params.operatorName },
    });
    return project;
  }

  async remove(id: string, operatorId: string, operatorName: string) {
    const existing = await this.prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { tables: true } } },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, '项目不存在');
    }
    await this.prisma.project.delete({ where: { id } });
    await this.audit.record({
      action: 'PROJECT_DELETE',
      userId: operatorId,
      resourceType: 'project',
      resourceId: id,
      detail: { name: existing.name, tableCount: existing._count.tables, by: operatorName },
    });
  }
}
