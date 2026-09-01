import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { buildPagination } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize: number = 300;
}

@ApiTags('审计日志')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('audit:read')
  @ApiOperation({ summary: '分页查询审计日志' })
  async list(@Query() q: AuditQueryDto) {
    const where = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.resourceType ? { resourceType: q.resourceType } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { username: true, displayName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      logs: rows,
      pagination: buildPagination(q.page, q.pageSize, total),
    };
  }
}
