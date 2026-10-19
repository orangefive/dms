import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { FIELD_TYPES, FieldType } from '../common/enums';
import { FieldsService } from './fields.service';

class SelectOptionDto {
  @IsString()
  @MaxLength(200)
  label!: string;

  @IsString()
  @MaxLength(200)
  value!: string;
}

class FieldConfigDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SelectOptionDto)
  options?: SelectOptionDto[];

  @IsOptional()
  @IsBoolean()
  showTime?: boolean;

  @IsOptional()
  @Type(() => Number)
  maxLength?: number;
}

class CreateFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  fieldKey?: string;

  @IsIn(FIELD_TYPES)
  fieldType!: FieldType;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FieldConfigDto)
  config?: FieldConfigDto;

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;

  @IsOptional()
  @IsBoolean()
  isIndexed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  formulaExpression?: string;
}

class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FieldConfigDto)
  config?: FieldConfigDto;

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;

  @IsOptional()
  @IsBoolean()
  isIndexed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  formulaExpression?: string;
}

class ReorderFieldsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  orderedIds!: string[];
}

class CreateConstraintDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fields!: string[];
}

@ApiTags('字段')
@ApiBearerAuth()
@Controller()
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Get('tables/:tableId/fields')
  @Permissions('field:read')
  @ApiOperation({ summary: '字段列表（按 sort_order 排序）' })
  async list(@Param('tableId') tableId: string) {
    return this.fieldsService.list(tableId);
  }

  @Post('tables/:tableId/fields')
  @Permissions('field:write')
  @ApiOperation({ summary: '创建字段（字段类型不可修改，FORMULA 需提供表达式）' })
  async create(
    @Param('tableId') tableId: string,
    @Body() dto: CreateFieldDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.fieldsService.create({
      tableId,
      name: dto.name,
      fieldKey: dto.fieldKey,
      fieldType: dto.fieldType,
      config: dto.config as never,
      isUnique: dto.isUnique,
      isIndexed: dto.isIndexed,
      formulaExpression: dto.formulaExpression,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Patch('fields/:id')
  @Permissions('field:write')
  @ApiOperation({ summary: '修改字段（禁止修改字段类型；修改公式后自动重算历史记录）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFieldDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.fieldsService.update(id, {
      name: dto.name,
      config: dto.config as never,
      isUnique: dto.isUnique,
      isIndexed: dto.isIndexed,
      formulaExpression: dto.formulaExpression,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Delete('fields/:id')
  @Permissions('field:delete')
  @ApiOperation({ summary: '删除字段（被公式引用时禁止删除）' })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string; username: string }) {
    await this.fieldsService.remove(id, user.id, user.username);
    return { deleted: true };
  }

  @Put('tables/:tableId/fields/reorder')
  @Permissions('field:write')
  @ApiOperation({ summary: '调整字段顺序' })
  async reorder(
    @Param('tableId') tableId: string,
    @Body() dto: ReorderFieldsDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.fieldsService.reorder(tableId, dto.orderedIds, user.id, user.username);
  }

  // ---- 组合唯一约束 ----

  @Get('tables/:tableId/constraints')
  @Permissions('field:read')
  @ApiOperation({ summary: '唯一约束列表（含单字段与组合）' })
  async listConstraints(@Param('tableId') tableId: string) {
    return this.fieldsService.listConstraints(tableId);
  }

  @Post('tables/:tableId/constraints')
  @Permissions('field:write')
  @ApiOperation({ summary: '创建组合唯一约束（如 shop + sku）' })
  async createConstraint(
    @Param('tableId') tableId: string,
    @Body() dto: CreateConstraintDto,
    @CurrentUser() user: { id: string; username: string } | null,
  ) {
    return this.fieldsService.createConstraint(
      tableId,
      dto.name,
      dto.fields,
      user?.id,
      user?.username,
    );
  }

  @Delete('constraints/:id')
  @Permissions('field:write')
  @ApiOperation({ summary: '删除唯一约束' })
  async removeConstraint(@Param('id') id: string) {
    return this.fieldsService.removeConstraint(id);
  }
}
