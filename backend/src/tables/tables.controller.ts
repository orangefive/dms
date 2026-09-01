import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { TableType, TABLE_TYPES } from '../common/enums';
import { TablesService } from './tables.service';

class CreateTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(TABLE_TYPES)
  tableType: TableType = TableType.SYSTEM;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalTableName?: string;
}

class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

class ListTablesDto {
  @IsOptional()
  @IsString()
  projectId?: string;
}

@ApiTags('数据表')
@ApiBearerAuth()
@Controller()
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('tables')
  @Permissions('table:read')
  @ApiOperation({ summary: '数据表列表（可按项目过滤）' })
  async list(@Query() q: ListTablesDto) {
    return this.tablesService.list(q.projectId);
  }

  @Post('projects/:projectId/tables')
  @Permissions('table:write')
  @ApiOperation({ summary: '在项目下创建数据表（SYSTEM 动态表 / EXTERNAL 注册物理表）' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTableDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.tablesService.create({
      projectId,
      name: dto.name,
      description: dto.description,
      tableType: dto.tableType,
      externalTableName: dto.externalTableName,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Get('tables/:id')
  @Permissions('table:read')
  @ApiOperation({ summary: '数据表详情' })
  async get(@Param('id') id: string) {
    return this.tablesService.get(id);
  }

  @Patch('tables/:id')
  @Permissions('table:write')
  @ApiOperation({ summary: '更新数据表' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.tablesService.update(id, {
      name: dto.name,
      description: dto.description,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Delete('tables/:id')
  @Permissions('table:delete')
  @ApiOperation({ summary: '删除数据表（级联删除字段与数据）' })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string; username: string }) {
    await this.tablesService.remove(id, user.id, user.username);
    return { deleted: true };
  }
}
