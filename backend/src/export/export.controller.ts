import { Body, Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { QueryDto } from '../query-engine/query.dto';
import { ExportService } from './export.service';

@ApiTags('导出')
@ApiBearerAuth()
@Controller('tables/:tableId/records/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * Excel 导出：全部数据或当前筛选结果。
   * 与 Query DSL 相同的请求体（filters/sort），第一行为字段名，
   * 文件名：项目名_数据表名_YYYYMMDD_HHmmss.xlsx
   */
  @Post()
  @HttpCode(200)
  @Permissions('export')
  @SkipTransform()
  @ApiOperation({ summary: '导出 Excel（全部数据或当前筛选结果，流式生成）' })
  async export(
    @Param('tableId') tableId: string,
    @Body() dto: QueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.exportService.exportTable(tableId, dto, res);
  }
}
