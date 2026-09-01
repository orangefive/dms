import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';

export interface ExternalColumnMeta {
  name: string;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  columnKey: string;
  comment: string;
  ordinal: number;
}

export interface ExternalTableMeta {
  name: string;
  comment: string;
  columns: ExternalColumnMeta[];
}

/** 标识符白名单：仅允许常规 MySQL 标识符 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * EXTERNAL 表元数据服务。
 * 表名/列名全部来自 information_schema 白名单（带短 TTL 缓存），
 * 禁止直接使用用户字符串拼接 SQL。
 */
@Injectable()
export class ExternalMetadataService {
  private readonly logger = new Logger(ExternalMetadataService.name);
  private readonly cacheTtlMs = 30_000;
  private tableCache = new Map<string, { at: number; meta: ExternalTableMeta }>();

  constructor(private readonly prisma: PrismaService) {}

  /** 校验标识符格式 */
  assertIdentifier(name: string, kind: 'table' | 'column'): void {
    if (!IDENTIFIER_PATTERN.test(name)) {
      throw AppError.badRequest(
        ErrorCodes.QUERY_INVALID_FIELD,
        `${kind === 'table' ? '表名' : '字段名'} "${name}" 非法（仅允许字母、数字、下划线）`,
      );
    }
  }

  /** 列出可注册的物理表（白名单） */
  async listTables(): Promise<Array<{ name: string; comment: string; columnCount: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ TABLE_NAME: string; TABLE_COMMENT: string | null }>>(
      Prisma.sql`SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
          AND TABLE_NAME <> '_prisma_migrations'
        ORDER BY TABLE_NAME`,
    );
    const result: Array<{ name: string; comment: string; columnCount: number }> = [];
    for (const row of rows) {
      if (!IDENTIFIER_PATTERN.test(row.TABLE_NAME)) {
        continue; // 跳过非常规标识符，避免风险
      }
      const count = await this.countColumns(row.TABLE_NAME);
      result.push({
        name: row.TABLE_NAME,
        comment: row.TABLE_COMMENT ?? '',
        columnCount: count,
      });
    }
    return result;
  }

  private async countColumns(tableName: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ c: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ${tableName}`,
    );
    return Number(rows[0]?.c ?? 0);
  }

  /** 获取表元数据（含列），带 30s 缓存 */
  async getTableMeta(tableName: string): Promise<ExternalTableMeta> {
    this.assertIdentifier(tableName, 'table');
    const cached = this.tableCache.get(tableName);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.meta;
    }
    const rows = await this.prisma.$queryRaw<
      Array<{
        TABLE_NAME: string;
        TABLE_COMMENT: string | null;
        COLUMN_NAME: string;
        DATA_TYPE: string;
        COLUMN_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_KEY: string;
        COLUMN_COMMENT: string | null;
        ORDINAL_POSITION: number;
      }>
    >(
      Prisma.sql`SELECT t.TABLE_NAME, t.TABLE_COMMENT, c.COLUMN_NAME, c.DATA_TYPE, c.COLUMN_TYPE,
        c.IS_NULLABLE, c.COLUMN_KEY, c.COLUMN_COMMENT, c.ORDINAL_POSITION
        FROM information_schema.tables t
        JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_schema = DATABASE() AND t.table_name = ${tableName}
        ORDER BY c.ORDINAL_POSITION`,
    );
    if (rows.length === 0) {
      throw AppError.badRequest(ErrorCodes.EXTERNAL_TABLE_NOT_FOUND, `物理表 "${tableName}" 不存在`);
    }
    const columns: ExternalColumnMeta[] = rows
      .filter((r) => IDENTIFIER_PATTERN.test(r.COLUMN_NAME)) // 列名白名单
      .map((r) => ({
        name: r.COLUMN_NAME,
        dataType: r.DATA_TYPE,
        columnType: r.COLUMN_TYPE,
        isNullable: r.IS_NULLABLE === 'YES',
        columnKey: r.COLUMN_KEY ?? '',
        comment: r.COLUMN_COMMENT ?? '',
        ordinal: r.ORDINAL_POSITION,
      }));
    const meta: ExternalTableMeta = {
      name: rows[0].TABLE_NAME,
      comment: rows[0].TABLE_COMMENT ?? '',
      columns,
    };
    this.tableCache.set(tableName, { at: Date.now(), meta });
    return meta;
  }
}
