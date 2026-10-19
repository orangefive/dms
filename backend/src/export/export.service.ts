import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { DataField, DataTable } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryService } from '../query-engine/query.service';
import { QueryDto } from '../query-engine/query.dto';
import { FieldType } from '../common/enums';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';

const FORMULA_ERROR_DISPLAY: Record<string, string> = {
  FORMULA_DIVIDE_BY_ZERO: '#DIV/0!',
  FORMULA_TYPE_ERROR: '#VALUE!',
  FORMULA_SYNTAX_ERROR: '#ERROR!',
  FORMULA_FIELD_NOT_FOUND: '#REF!',
  FORMULA_INVALID_FUNCTION: '#NAME?',
  FORMULA_INVALID_ARGUMENT: '#N/A',
  FORMULA_CIRCULAR_REFERENCE: '#CIRC!',
  FORMULA_DEPENDENCY_ERROR: '#VALUE!',
};

/**
 * Excel 导出（ExcelJS 流式 WorkbookWriter）：
 * - 全部数据 / 当前筛选结果
 * - 第一行为字段名
 * - 文件名：项目名_数据表名_YYYYMMDD_HHmmss.xlsx
 * - FORMULA 导出当前计算结果，不转为 Excel 原生公式
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: QueryService,
  ) {}

  async exportTable(tableId: string, queryDto: QueryDto, res: Response): Promise<void> {
    const table = await this.queryService.loadTable(tableId);
    const fields = await this.queryService.loadFields(tableId);
    if (fields.length === 0) {
      throw AppError.badRequest(ErrorCodes.FIELD_NOT_FOUND, '数据表还没有字段，无法导出');
    }
    const tableWithProject = table as DataTable & { project?: { name?: string } };

    // 先做一次计数查询，确认可执行（失败时还未写入响应头）
    const firstPage = await this.queryService.query(tableId, {
      ...queryDto,
      page: 1,
      pageSize: 500,
    });

    const projectName = sanitizeFilename(tableWithProject.project?.name ?? '项目');
    const tableName = sanitizeFilename(table.name);
    const stamp = formatStamp(new Date());
    const filename = `${projectName}_${tableName}_${stamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
    });
    const sheet = workbook.addWorksheet(trimSheetName(tableName));

    // 第一行：字段名
    sheet.addRow(fields.map((f) => f.name)).commit();

    const writePage = (records: Array<{ data: Record<string, unknown>; formulaErrors?: Record<string, string> }>): void => {
      for (const record of records) {
        const values = fields.map((f) => this.formatValue(f, record.data, record.formulaErrors));
        sheet.addRow(values).commit();
      }
    };

    writePage(firstPage.records);

    const total = firstPage.pagination.total;
    const pageSize = 500;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const maxPages = 2000; // 100 万行安全上限
    for (let page = 2; page <= totalPages && page <= maxPages; page += 1) {
      const outcome = await this.queryService.query(tableId, {
        ...queryDto,
        page,
        pageSize,
      });
      writePage(outcome.records);
    }

    await workbook.commit();
    res.end();
  }

  private formatValue(field: DataField, data: Record<string, unknown>, formulaErrors?: Record<string, string>): string | number | boolean {
    const raw = data[field.fieldKey];
    if (raw === null || raw === undefined) {
      return '';
    }
    if (field.fieldType === FieldType.FORMULA) {
      const code = formulaErrors?.[field.fieldKey];
      if (code) {
        return FORMULA_ERROR_DISPLAY[code] ?? '#ERROR!';
      }
      return this.formatScalar(raw);
    }
    if (field.fieldType === FieldType.SINGLE_SELECT) {
      const options = ((field.config as { options?: Array<{ label: string; value: string }> } | null)?.options) ?? [];
      const option = options.find((o) => o.value === raw);
      return option ? option.label : String(raw);
    }
    if (field.fieldType === FieldType.MULTI_SELECT) {
      if (!Array.isArray(raw)) {
        return String(raw);
      }
      const options = ((field.config as { options?: Array<{ label: string; value: string }> } | null)?.options) ?? [];
      return raw
        .map((v) => options.find((o) => o.value === v)?.label ?? String(v))
        .join(', ');
    }
    return this.formatScalar(raw);
  }

  private formatScalar(raw: unknown): string | number | boolean {
    if (typeof raw === 'number' || typeof raw === 'boolean') {
      return raw;
    }
    return String(raw);
  }

  /** 导出时附带公式错误信息（查询层合并） */
  static attachFormulaErrors(records: Array<{ data: Record<string, unknown>; formula_errors?: unknown }>): void {
    for (const r of records) {
      if (r.formula_errors) {
        r.data.__formulaErrors = r.formula_errors as Record<string, string>;
      }
    }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '导出';
}

function trimSheetName(name: string): string {
  return (name.replace(/[\\/:*?"<>|[\]]/g, '_') || 'Sheet1').slice(0, 31);
}

function formatStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
