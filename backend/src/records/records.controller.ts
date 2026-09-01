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
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import { AuthContext } from '../common/types/auth-context';
import { PaginationDto } from '../common/dto/pagination.dto';
import { QueryService } from '../query-engine/query.service';
import { QueryDto } from '../query-engine/query.dto';
import { FindOneDto, FindQueryDto } from '../query-engine/query.dto';
import { RecordsService } from './records.service';

class RecordDataDto {
  @IsObject()
  data!: Record<string, unknown>;
}

class BatchCreateDto {
  @IsArray()
  @ArrayMaxSize(1000)
  records!: Array<Record<string, unknown>>;
}

class BatchDeleteDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids!: string[];
}

class UpsertDto {
  @IsObject()
  match!: Record<string, unknown>;

  @IsObject()
  data!: Record<string, unknown>;
}

class BatchUpsertDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => UpsertDto)
  items!: UpsertDto[];
}

class ListRecordsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  sortField?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

function actorOf(auth: AuthContext | null): { id?: string; username?: string } {
  if (!auth) {
    return {};
  }
  return auth.type === 'user'
    ? { id: auth.id, username: auth.username }
    : { id: undefined, username: `api-key:${auth.name}` };
}

@ApiTags('数据记录')
@ApiBearerAuth()
@Controller('tables/:tableId/records')
export class RecordsController {
  constructor(
    private readonly recordsService: RecordsService,
    private readonly queryService: QueryService,
  ) {}

  @Get()
  @Permissions('record:read')
  @ApiOperation({ summary: '分页查询记录（MySQL 层排序分页）' })
  async list(@Param('tableId') tableId: string, @Query() q: ListRecordsDto) {
    return this.queryService.query(tableId, {
      sort: q.sortField && q.sortOrder ? [{ field: q.sortField, order: q.sortOrder }] : undefined,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Post('query')
  @Permissions('record:read')
  @ApiOperation({ summary: 'Query DSL 查询（筛选/排序/分页，MySQL 层执行）' })
  async query(@Param('tableId') tableId: string, @Body() dto: QueryDto) {
    return this.queryService.query(tableId, dto);
  }

  @Get('find')
  @Permissions('record:read')
  @ApiOperation({ summary: '快捷精确查询（EXACT MATCH，禁止模糊）: ?field=sku&value=ABC123' })
  async find(@Param('tableId') tableId: string, @Query() q: FindQueryDto) {
    return this.queryService.findExact(tableId, q.field, q.value, 1, q.pageSize);
  }

  @Post('find-one')
  @Permissions('record:read')
  @ApiOperation({ summary: '精确查询单条（0 条返回 record: null；多条报 MULTIPLE_RECORDS_FOUND）' })
  async findOne(@Param('tableId') tableId: string, @Body() dto: FindOneDto) {
    const record = await this.queryService.findOne(tableId, dto.field, dto.value);
    return { record };
  }

  @Post()
  @Permissions('record:write')
  @ApiOperation({ summary: '创建记录（类型/选项/日期/唯一约束/公式校验）' })
  async create(
    @Param('tableId') tableId: string,
    @Body() dto: RecordDataDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.create(tableId, dto.data, actorOf(auth));
  }

  @Get(':recordId')
  @Permissions('record:read')
  @ApiOperation({ summary: '单条记录详情' })
  async get(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.recordsService.getRecord(tableId, recordId);
  }

  @Patch(':recordId')
  @Permissions('record:write')
  @ApiOperation({ summary: '更新记录（仅重算受变更字段影响的公式）' })
  async update(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body() dto: RecordDataDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.update(tableId, recordId, dto.data, actorOf(auth));
  }

  @Delete(':recordId')
  @Permissions('record:delete')
  @ApiOperation({ summary: '删除记录' })
  async remove(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.remove(tableId, recordId, actorOf(auth));
  }

  @Post('batch-delete')
  @Permissions('record:delete')
  @ApiOperation({ summary: '批量删除记录（仅删除该数据表内的记录，事务执行）' })
  async batchDelete(
    @Param('tableId') tableId: string,
    @Body() dto: BatchDeleteDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.batchRemove(tableId, dto.ids, actorOf(auth));
  }

  @Post('batch')
  @Permissions('record:write')
  @ApiOperation({ summary: '批量写入（事务，BATCH_INSERT_LIMIT 上限）' })
  async batch(
    @Param('tableId') tableId: string,
    @Body() dto: BatchCreateDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.batchCreate(tableId, dto.records, actorOf(auth));
  }

  @Post('upsert')
  @Permissions('record:write')
  @ApiOperation({ summary: 'Upsert（match 精确匹配，存在更新/不存在插入）' })
  async upsert(
    @Param('tableId') tableId: string,
    @Body() dto: UpsertDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.upsert(tableId, dto.match, dto.data, actorOf(auth));
  }

  @Post('batch-upsert')
  @Permissions('record:write')
  @ApiOperation({ summary: '批量 Upsert（逐条精确匹配）' })
  async batchUpsert(
    @Param('tableId') tableId: string,
    @Body() dto: BatchUpsertDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.recordsService.batchUpsert(tableId, dto.items, actorOf(auth));
  }
}
