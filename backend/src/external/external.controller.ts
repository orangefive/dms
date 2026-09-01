import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExternalMetadataService } from './external-metadata.service';

@ApiTags('外部数据表')
@ApiBearerAuth()
@Controller('external')
export class ExternalController {
  constructor(private readonly externalMetadata: ExternalMetadataService) {}

  /** 浏览可注册的物理表 */
  @Get('tables')
  @Permissions('table:write')
  @ApiOperation({ summary: '浏览可注册的 MySQL 物理表（来自 information_schema 白名单）' })
  async listTables(): Promise<Array<{ name: string; comment: string; columnCount: number }>> {
    return this.externalMetadata.listTables();
  }

  /** 浏览物理表列元数据 */
  @Get('tables/:tableName/columns')
  @Permissions('table:write')
  @ApiOperation({ summary: '获取物理表的列元数据' })
  async getColumns(@Param('tableName') tableName: string) {
    const meta = await this.externalMetadata.getTableMeta(tableName);
    return { name: meta.name, comment: meta.comment, columns: meta.columns };
  }
}
