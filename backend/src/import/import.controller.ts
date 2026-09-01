import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import { AuthContext } from '../common/types/auth-context';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { ImportService } from './import.service';

function actorOf(auth: AuthContext | null): { id?: string; username?: string } {
  if (!auth) {
    return {};
  }
  return auth.type === 'user'
    ? { id: auth.id, username: auth.username }
    : { id: undefined, username: `api-key:${auth.name}` };
}

@ApiTags('Excel 导入')
@ApiBearerAuth()
@Controller('tables/:tableId/records')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /**
   * 导入 Excel（.xlsx）：
   * - 第一行为表头，按 字段标识 / 字段名称 匹配数据表字段
   * - 未匹配列与公式列自动跳过并报告
   * - 逐行校验（类型/选项/日期/唯一约束/公式），失败行收集错误不影响其余行
   */
  @Post('import')
  @HttpCode(200)
  @Permissions('record:write')
  @ApiOperation({ summary: '导入 Excel：表头与数据表字段匹配后写入记录' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importExcel(
    @Param('tableId') tableId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    if (!file) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, '请上传 .xlsx 文件（表单字段名: file）');
    }
    if (!/\.xlsx$/i.test(file.originalname) && !/spreadsheetml/.test(file.mimetype ?? '')) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, '仅支持 .xlsx 格式的 Excel 文件');
    }
    return this.importService.importExcel(tableId, file.buffer, actorOf(auth));
  }

  /** 下载导入模板（第一行为可导入字段名） */
  @Get('import/template')
  @HttpCode(200)
  @Permissions('record:write')
  @SkipTransform()
  @ApiOperation({ summary: '下载导入模板（第一行为字段名）' })
  async template(@Param('tableId') tableId: string, @Res() res: Response): Promise<void> {
    const buffer = await this.importService.buildTemplate(tableId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent('导入模板.xlsx')}`,
    );
    res.end(buffer);
  }
}
