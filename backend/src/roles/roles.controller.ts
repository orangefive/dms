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
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ALL_PERMISSIONS } from '../common/permissions';
import { RolesService } from './roles.service';

class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions!: string[];
}

class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: string[];
}

@ApiTags('角色管理')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions('role:manage')
  @ApiOperation({ summary: '角色列表（含用户数与权限）' })
  async list() {
    return this.rolesService.list();
  }

  @Post()
  @Permissions('role:manage')
  @ApiOperation({ summary: '创建自定义角色' })
  async create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @Permissions('role:manage')
  @ApiOperation({ summary: '编辑角色（系统内置角色不可修改）' })
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('role:manage')
  @ApiOperation({ summary: '删除自定义角色' })
  async remove(@Param('id') id: string) {
    await this.rolesService.remove(id);
    return { deleted: true };
  }
}
