import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ConfigService } from '@nestjs/config';
import { DataField } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryService } from '../query-engine/query.service';
import { RecordsService, ActorInfo } from '../records/records.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FieldType, TableType } from '../common/enums';
import { AppConfig } from '../config/env.validation';

export interface ImportRowError {
  row: number;
  code: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  totalRows: number;
  skippedColumns: string[];
  duplicateColumns: string[];
  errors: ImportRowError[];
}

interface ColumnDef {
  header: string;
  /** Excel 列号（1 起） */
  excelIndex: number;
  field: DataField | null;
  /** 公式字段 / 未匹配字段不可导入 */
  skip: boolean;
  reason: string | null;
}

/**
 * Excel 导入服务：
 * - 仅支持 .xlsx（ExcelJS）
 * - 第一行为表头，按 字段标识(field_key) → 字段名称(name) 匹配数据表字段
 * - 未匹配的列与公式列跳过并在结果中报告
 * - 单选/多选支持 选项值(value) 与显示名(label) 两种写法
 * - 逐行校验（类型/选项/日期/唯一约束/公式），失败行收集错误，不影响其余行
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: QueryService,
    private readonly recordsService: RecordsService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async importExcel(tableId: string, buffer: Buffer, actor: ActorInfo): Promise<ImportResult> {
    const table = await this.queryService.loadTable(tableId);
    if (table.tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(
        ErrorCodes.EXTERNAL_TABLE_READ_ONLY,
        'EXTERNAL 表为只读数据源，不支持导入',
      );
    }
    const fields = await this.queryService.loadFields(tableId);
    const limit = this.importLimit();
    if (buffer.length === 0) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, '文件内容为空');
    }
    if (buffer.length > 20 * 1024 * 1024) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, '文件大小不能超过 20MB');
    }

    let workbook: ExcelJS.Workbook;
    try {
      workbook = new ExcelJS.Workbook();
      // Node 24 的 Buffer 泛型与 ExcelJS 类型声明不一致，显式转换
      await workbook.xlsx.load(
        buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
      );
    } catch {
      throw AppError.badRequest(
        ErrorCodes.INVALID_EXCEL_FILE,
        '无法解析该文件，请确认为 .xlsx 格式的 Excel 文件',
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, 'Excel 中没有工作表');
    }
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let c = 1; c <= headerRow.cellCount; c += 1) {
      headers.push(cellToText(headerRow.getCell(c).value).trim());
    }
    if (headers.length === 0 || headers.every((h) => h === '')) {
      throw AppError.badRequest(ErrorCodes.INVALID_EXCEL_FILE, 'Excel 第一行必须为字段表头');
    }

    // 列匹配：field_key 精确 → 字段名称精确；重复表头只取第一列
    const seenHeaders = new Set<string>();
    const duplicateColumns: string[] = [];
    const columns: ColumnDef[] = headers.map((header, index) => {
      if (!header) {
        return { header, excelIndex: index + 1, field: null, skip: true, reason: '空表头' };
      }
      if (seenHeaders.has(header)) {
        duplicateColumns.push(header);
        return { header, excelIndex: index + 1, field: null, skip: true, reason: '表头重复（仅导入第一列）' };
      }
      seenHeaders.add(header);
      const field =
        fields.find((f) => f.fieldKey === header) ?? fields.find((f) => f.name === header);
      if (!field) {
        return { header, excelIndex: index + 1, field: null, skip: true, reason: '未匹配到任何字段' };
      }
      if (field.fieldType === FieldType.FORMULA) {
        return { header, excelIndex: index + 1, field, skip: true, reason: '公式字段只读，不可导入' };
      }
      return { header, excelIndex: index + 1, field, skip: false, reason: null };
    });

    const totalRows = Math.max(0, sheet.rowCount - 1);
    if (totalRows > limit) {
      throw AppError.badRequest(
        ErrorCodes.EXCEL_IMPORT_LIMIT_EXCEEDED,
        `导入行数 ${totalRows} 超过上限 ${limit}（EXCEL_IMPORT_LIMIT）`,
      );
    }

    const skippedColumns = columns.filter((c) => c.skip).map((c) => c.header || '(空)');
    const errors: ImportRowError[] = [];
    let imported = 0;

    // 元数据只加载一次，避免每行都查询表/字段/唯一约束
    const constraints = await this.prisma.uniqueConstraint.findMany({ where: { tableId } });

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      if (isBlankRow(row)) {
        continue;
      }
      const data: Record<string, unknown> = {};
      for (const col of columns) {
        if (col.skip || !col.field) {
          continue;
        }
        const raw = row.getCell(col.excelIndex).value;
        const value = this.convertValue(raw, col.field);
        if (value !== undefined && value !== '') {
          data[col.field.fieldKey] = value;
        }
      }
      if (Object.keys(data).length === 0) {
        continue;
      }
      try {
        await this.recordsService.createPrepared(tableId, fields, constraints, data, actor, {
          audit: false,
        });
        imported += 1;
      } catch (err) {
        if (err instanceof AppError) {
          errors.push({ row: r, code: err.code, message: err.message });
        } else {
          errors.push({ row: r, code: 'INTERNAL_ERROR', message: '导入该行时发生内部错误' });
        }
      }
    }

    // 导入是“逐行独立事务”，一次汇总审计代替 N 条记录审计
    await this.audit.record({
      action: 'RECORD_BATCH_CREATE',
      userId: actor.id ?? null,
      resourceType: 'table',
      resourceId: tableId,
      detail: {
        source: 'excel-import',
        totalRows,
        imported,
        failed: errors.length,
        skippedColumns,
      },
    });

    return { imported, totalRows, skippedColumns, duplicateColumns, errors };
  }

  /** 生成导入模板（第一行为可导入字段名） */
  async buildTemplate(tableId: string): Promise<Buffer> {
    const fields = await this.queryService.loadFields(tableId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('导入模板');
    const headers = fields
      .filter((f) => f.fieldType !== FieldType.FORMULA)
      .map((f) => f.name);
    sheet.addRow(headers);
    // 首行样式
    sheet.getRow(1).font = { bold: true };
    const widths = headers.map((h) => Math.min(28, Math.max(10, String(h).length * 2 + 6)));
    sheet.columns = headers.map((h, i) => ({ header: h, key: String(i), width: widths[i] }));
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private importLimit(): number {
    const cfg = this.configService.get<AppConfig>('app');
    const env = process.env.EXCEL_IMPORT_LIMIT;
    const n = env ? Number(env) : NaN;
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 5000);
    }
    return cfg?.batchInsertLimit ?? 1000;
  }

  /** Excel 单元格值 → 字段值（选项 label/value 双匹配、多选拆分、日期格式化） */
  private convertValue(raw: unknown, field: DataField): unknown {
    const value = unwrapCellValue(raw);
    if (value === null || value === undefined) {
      return undefined;
    }
    const type = field.fieldType;

    if (type === FieldType.NUMBER) {
      if (typeof value === 'number') {
        return value;
      }
      const s = String(value).trim();
      return s === '' || Number.isNaN(Number(s)) ? String(value) : Number(s);
    }

    if (type === FieldType.DATE) {
      if (value instanceof Date) {
        const showTime = Boolean((field.config as { showTime?: boolean } | null)?.showTime);
        return formatDate(value, showTime);
      }
      return String(value).trim();
    }

    if (type === FieldType.SINGLE_SELECT) {
      const text = String(value).trim();
      const options = (field.config as { options?: Array<{ label: string; value: string }> } | null)
        ?.options ?? [];
      const hit = options.find((o) => o.value === text) ?? options.find((o) => o.label === text);
      return hit ? hit.value : text;
    }

    if (type === FieldType.MULTI_SELECT) {
      const text = String(value).trim();
      if (!text) {
        return undefined;
      }
      const options = (field.config as { options?: Array<{ label: string; value: string }> } | null)
        ?.options ?? [];
      const parts = text.split(/[,，;；、]/).map((p) => p.trim()).filter(Boolean);
      return parts.map((p) => {
        const hit = options.find((o) => o.value === p) ?? options.find((o) => o.label === p);
        return hit ? hit.value : p;
      });
    }

    // 文本类
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}

/** 取单元格显示值：公式取结果、富文本取文本 */
function unwrapCellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('result' in obj && obj.result !== undefined && obj.result !== null) {
      return obj.result;
    }
    if ('text' in obj && obj.text !== undefined) {
      return obj.text;
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((t) => String((t as { text?: unknown }).text ?? '')).join('');
    }
    if (obj instanceof Date) {
      return obj;
    }
    return null;
  }
  return raw;
}

function cellToText(raw: unknown): string {
  const v = unwrapCellValue(raw);
  if (v === null || v === undefined) {
    return '';
  }
  return String(v);
}

function isBlankRow(row: ExcelJS.Row): boolean {
  for (let c = 1; c <= row.cellCount; c += 1) {
    const v = unwrapCellValue(row.getCell(c).value);
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return false;
    }
  }
  return true;
}

function formatDate(d: Date, showTime: boolean): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (!showTime) {
    return date;
  }
  return `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
