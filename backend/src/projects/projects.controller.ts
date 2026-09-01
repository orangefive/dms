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
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-auth.decorator';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

class UpdateProjectDto {
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

class ListProjectsDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  withTables: boolean = false;
}

@ApiTags('项目')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Permissions('project:read')
  @ApiOperation({ summary: '项目列表（withTables=true 时附带数据表树）' })
  async list(@Query() q: ListProjectsDto) {
    return this.projectsService.list(q.withTables);
  }

  @Post()
  @Permissions('project:write')
  @ApiOperation({ summary: '创建项目' })
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: { id: string; username: string }) {
    return this.projectsService.create({
      name: dto.name,
      description: dto.description,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Get(':id')
  @Permissions('project:read')
  @ApiOperation({ summary: '项目详情（含数据表）' })
  async get(@Param('id') id: string) {
    return this.projectsService.get(id);
  }

  @Patch(':id')
  @Permissions('project:write')
  @ApiOperation({ summary: '更新项目' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: { id: string; username: string },
  ) {
    return this.projectsService.update(id, {
      name: dto.name,
      description: dto.description,
      operatorId: user.id,
      operatorName: user.username,
    });
  }

  @Delete(':id')
  @Permissions('project:delete')
  @ApiOperation({ summary: '删除项目（级联删除数据表与数据）' })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string; username: string }) {
    await this.projectsService.remove(id, user.id, user.username);
    return { deleted: true };
  }
}
