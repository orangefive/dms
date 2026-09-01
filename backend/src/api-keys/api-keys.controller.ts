import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiKeysService, normalizeScopes } from './api-keys.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { ALL_PERMISSIONS } from '../common/permissions';

class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsIn(ALL_PERMISSIONS, { each: true, message: '权限编码非法' })
  scopes?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsIn(ALL_PERMISSIONS, { each: true, message: '权限编码非法' })
  scopes?: string[];

  @IsOptional()
  @Type(() => Date)
  expiresAt?: Date | null;
}

@ApiTags('API 密钥')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeysService: ApiKeysService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Permissions('api-key:read')
  @ApiOperation({ summary: 'API 密钥列表（不含完整 Key）' })
  async list() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        isActive: true,
        createdAt: true,
        createdBy: { select: { username: true, displayName: true } },
      },
    });
  }

  @Post()
  @Permissions('api-key:write')
  @ApiOperation({ summary: '创建 API 密钥（完整 Key 仅此一次返回）' })
  async create(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    const { key, keyHash, keyPrefix } = this.apiKeysService.generateKey();
    const scopes = normalizeScopes(dto.scopes);
    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyHash,
        keyPrefix,
        scopes: scopes as unknown as object,
        createdById: user.id,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      select: { id: true, name: true, keyPrefix: true, scopes: true, expiresAt: true, createdAt: true },
    });
    await this.audit.record({
      action: 'API_KEY_CREATE',
      userId: user.id,
      resourceType: 'api_key',
      resourceId: record.id,
      detail: { name: dto.name, by: user.username },
    });
    return { ...record, key };
  }

  @Patch(':id')
  @Permissions('api-key:write')
  @ApiOperation({ summary: '更新 API 密钥（名称/启用状态/权限范围/过期时间）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
    @CurrentUser() user: { id: string },
  ) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, 'API 密钥不存在');
    }
    const record = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.scopes !== undefined
          ? { scopes: normalizeScopes(dto.scopes) as unknown as object }
          : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }
          : {}),
      },
      select: { id: true, name: true, keyPrefix: true, isActive: true, scopes: true, expiresAt: true },
    });
    await this.audit.record({
      action: 'API_KEY_UPDATE',
      userId: user.id,
      resourceType: 'api_key',
      resourceId: id,
      detail: { name: existing.name },
    });
    return record;
  }

  @Delete(':id')
  @Permissions('api-key:delete')
  @ApiOperation({ summary: '删除 API 密钥' })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, 'API 密钥不存在');
    }
    await this.prisma.apiKey.delete({ where: { id } });
    await this.audit.record({
      action: 'API_KEY_DELETE',
      userId: user.id,
      resourceType: 'api_key',
      resourceId: id,
      detail: { name: existing.name },
    });
    return { deleted: true };
  }
}
