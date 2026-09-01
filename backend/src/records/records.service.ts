import { Injectable } from '@nestjs/common';
import { DataField, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';import { QueryService } from '../query-engine/query.service';
import { FormulaService } from '../formula/formula.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FieldType, TableType } from '../common/enums';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env.validation';

export interface ActorInfo {
  id?: string;
  username?: string;
}

/**
 * 记录服务（SYSTEM 动态表）：
 * 创建/更新/删除/Batch/Upsert 全流程：
 *   字段校验（拒绝未知字段、类型校验、选项校验、日期校验、FORMULA 只读）
 *   → 唯一约束校验（单字段 + 组合，数据库级唯一索引兜底）
 *   → 公式依赖排序计算（物化到 data）
 *   → 事务写入
 */
@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: QueryService,
    private readonly formulaService: FormulaService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async create(tableId: string, data: Record<string, unknown>, actor: ActorInfo) {
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);
    const fields = await this.queryService.loadFields(tableId);
    const normalized = this.validateAndNormalize(fields, data);
    const computed = this.formulaService.computeRecord(fields, normalized);
    const constraints = await this.prisma.uniqueConstraint.findMany({ where: { tableId } });

    let record;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tableRecord.create({
          data: {
            tableId,
            data: computed.data as object,
            formulaErrors: this.nullableErrors(computed.formulaErrors),
            createdBy: actor.id ?? null,
            updatedBy: actor.id ?? null,
          },
        });
        await this.syncUniqueValues(tx, constraints, created.id, computed.data);
        return created;      });
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }

    await this.audit.record({
      action: 'RECORD_CREATE',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: record.id,
      detail: { tableId, keys: Object.keys(normalized) },
    });
    return { id: record.id, data: computed.data };
  }

  async update(tableId: string, recordId: string, data: Record<string, unknown>, actor: ActorInfo) {
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);
    const fields = await this.queryService.loadFields(tableId);
    const existing = await this.prisma.tableRecord.findUnique({ where: { id: recordId } });
    if (!existing || existing.tableId !== tableId) {
      throw AppError.notFound(ErrorCodes.RECORD_NOT_FOUND, '记录不存在');
    }

    const normalized = this.validateAndNormalize(fields, data);
    // 仅重算受变更字段影响的公式及其下游
    const changedKeys = new Set(Object.keys(data));
    const merged = { ...(existing.data as Record<string, unknown>), ...normalized };
    const computed = this.formulaService.computeRecord(fields, merged, changedKeys);
    const constraints = await this.prisma.uniqueConstraint.findMany({ where: { tableId } });

    let record;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.tableRecord.update({
          where: { id: recordId },
          data: {
            data: computed.data as object,
            formulaErrors: this.nullableErrors(computed.formulaErrors),
            updatedBy: actor.id ?? null,
          },
        });
        await tx.uniqueValue.deleteMany({ where: { recordId } });
        await this.syncUniqueValues(tx, constraints, recordId, computed.data);
        return updated;
      });
    } catch (err) {
      this.rethrowUniqueViolation(err);
      throw err;
    }

    await this.audit.record({
      action: 'RECORD_UPDATE',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: recordId,
      detail: { tableId, keys: Object.keys(normalized) },
    });
    return { id: record.id, data: computed.data };
  }

  async getRecord(tableId: string, recordId: string) {
    await this.queryService.loadTable(tableId);
    const existing = await this.prisma.tableRecord.findUnique({ where: { id: recordId } });
    if (!existing || existing.tableId !== tableId) {
      throw AppError.notFound(ErrorCodes.RECORD_NOT_FOUND, '记录不存在');
    }
    return { record: existing };
  }

  async remove(tableId: string, recordId: string, actor: ActorInfo) {
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);
    const existing = await this.prisma.tableRecord.findUnique({ where: { id: recordId } });
    if (!existing || existing.tableId !== tableId) {
      throw AppError.notFound(ErrorCodes.RECORD_NOT_FOUND, '记录不存在');
    }
    await this.prisma.tableRecord.delete({ where: { id: recordId } });
    await this.audit.record({
      action: 'RECORD_DELETE',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: recordId,
      detail: { tableId },
    });
    return { deleted: true };
  }

  /** 批量删除：仅删除指定数据表内的记录，事务执行 */
  async batchRemove(tableId: string, ids: string[], actor: ActorInfo): Promise<{ deleted: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '请至少选择一条要删除的记录');
    }
    const limit = 5000;
    if (ids.length > limit) {
      throw AppError.badRequest(
        ErrorCodes.BATCH_LIMIT_EXCEEDED,
        `批量删除数量 ${ids.length} 超过上限 ${limit}`,
      );
    }
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);

    const result = await this.prisma.tableRecord.deleteMany({
      where: { id: { in: ids }, tableId },
    });
    await this.audit.record({
      action: 'RECORD_BATCH_DELETE',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: tableId,
      detail: { tableId, count: result.count, requested: ids.length },
    });
    return { deleted: result.count };
  }

  async batchCreate(tableId: string, records: Array<Record<string, unknown>>, actor: ActorInfo) {
    const appConfig = this.configService.get<AppConfig>('app');
    const limit = appConfig?.batchInsertLimit ?? 1000;
    if (records.length > limit) {
      throw AppError.badRequest(
        ErrorCodes.BATCH_LIMIT_EXCEEDED,
        `批量写入数量 ${records.length} 超过上限 ${limit}（BATCH_INSERT_LIMIT）`,
      );
    }
    if (records.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '批量写入不能为空');
    }
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);
    const fields = await this.queryService.loadFields(tableId);
    const constraints = await this.prisma.uniqueConstraint.findMany({ where: { tableId } });

    // 先全量校验（任一失败 → 整体拒绝，避免半成功）
    const prepared = records.map((r, index) => {
      try {
        const normalized = this.validateAndNormalize(fields, r);
        const computed = this.formulaService.computeRecord(fields, normalized);
        return { normalized, computed };
      } catch (err) {
        if (err instanceof AppError) {
          throw new AppError(err.code, `第 ${index + 1} 条记录: ${err.message}`, err.status);
        }
        throw err;
      }
    });

    let createdCount = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of prepared) {
          const created = await tx.tableRecord.create({
            data: {
              tableId,
              data: item.computed.data as object,
              formulaErrors: this.nullableErrors(item.computed.formulaErrors),
              createdBy: actor.id ?? null,
              updatedBy: actor.id ?? null,
            },
          });
          await this.syncUniqueValues(tx, constraints, created.id, item.computed.data);
          createdCount += 1;
        }
      });
    } catch (err) {
      this.rethrowUniqueViolation(err, true);
      throw err;
    }

    await this.audit.record({
      action: 'RECORD_BATCH_CREATE',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: tableId,
      detail: { tableId, count: createdCount },
    });
    return { created: createdCount };
  }

  /**
   * Upsert：match 精确匹配（EXACT）。
   * 0 条 → INSERT（合并 match 与 data）；1 条 → UPDATE；多条 → MULTIPLE_RECORDS_FOUND
   */
  async upsert(
    tableId: string,
    match: Record<string, unknown>,
    data: Record<string, unknown>,
    actor: ActorInfo,
  ) {
    const table = await this.queryService.loadTable(tableId);
    this.assertWritable(table.tableType);
    const fields = await this.queryService.loadFields(tableId);
    this.validateMatchFields(fields, match);

    // EXACT 精确匹配定位（单字段或多字段组合，全部 eq，禁止 LIKE/contains）
    const filters = Object.entries(match).map(([field, value]) => ({
      field,
      operator: 'eq' as const,
      value,
    }));
    const outcome = await this.queryService.query(tableId, {
      filters,
      page: 1,
      pageSize: 2,
    });
    const found = outcome.records[0] ?? null;
    const multi = outcome.records.length > 1;
    if (multi) {
      throw AppError.badRequest(
        ErrorCodes.MULTIPLE_RECORDS_FOUND,
        'Upsert 匹配到多条记录（match 字段不是唯一约束），请使用唯一字段或组合唯一约束',
      );
    }
    if (found === null) {
      const merged = { ...match, ...data };
      const created = await this.create(tableId, merged, actor);
      await this.audit.record({
        action: 'RECORD_UPSERT',
        userId: actor.id ?? null,
        resourceType: 'record',
        resourceId: created.id,
        detail: { tableId, mode: 'insert', match },
      });
      return { mode: 'insert' as const, record: created };
    }
    const updated = await this.update(tableId, found.id as string, data, actor);
    await this.audit.record({
      action: 'RECORD_UPSERT',
      userId: actor.id ?? null,
      resourceType: 'record',
      resourceId: updated.id,
      detail: { tableId, mode: 'update', match },
    });
    return { mode: 'update' as const, record: updated };
  }

  async batchUpsert(
    tableId: string,
    items: Array<{ match: Record<string, unknown>; data: Record<string, unknown> }>,
    actor: ActorInfo,
  ) {
    const appConfig = this.configService.get<AppConfig>('app');
    const limit = appConfig?.batchInsertLimit ?? 1000;
    if (items.length > limit) {
      throw AppError.badRequest(
        ErrorCodes.BATCH_LIMIT_EXCEEDED,
        `批量 Upsert 数量 ${items.length} 超过上限 ${limit}（BATCH_INSERT_LIMIT）`,
      );
    }
    const results: Array<{ index: number; mode: 'insert' | 'update'; id: string }> = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || !item.match || typeof item.match !== 'object') {
        throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, `第 ${i + 1} 条记录缺少 match`);
      }
      const result = await this.upsert(tableId, item.match, item.data ?? {}, actor);
      results.push({ index: i, mode: result.mode, id: result.record.id });
    }
    return { results, total: results.length };
  }

  // ---- 校验与规范化 ----

  private assertWritable(tableType: string): void {
    if (tableType === TableType.EXTERNAL) {
      throw AppError.badRequest(
        ErrorCodes.EXTERNAL_TABLE_READ_ONLY,
        'EXTERNAL 表为只读数据源（通过 n8n 写入原系统后在此查询），不支持直接增删改',
      );
    }
  }

  /** 校验并规范化写入数据：拒绝未知字段 / 类型校验 / 选项校验 / 日期校验 / FORMULA 只读 */
  private validateAndNormalize(
    fields: DataField[],
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, '数据必须是对象');
    }
    const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const field = byKey.get(key);
      if (!field) {
        throw AppError.badRequest(
          ErrorCodes.UNKNOWN_FIELD_IN_DATA,
          `数据中包含不存在的字段 "${key}"（可用字段: ${[...byKey.keys()].join(', ')}）`,
        );
      }
      if (value === null || value === undefined) {
        continue; // null 不写入 data（缺失即空）
      }
      if (field.fieldType === FieldType.FORMULA) {
        throw AppError.badRequest(
          ErrorCodes.FORMULA_FIELD_READ_ONLY,
          `公式字段 "${field.name}" 为只读计算字段，不允许直接写入`,
        );
      }
      out[key] = this.validateValue(field, value);
    }
    return out;
  }

  private validateValue(field: DataField, value: unknown): unknown {
    const name = field.name;
    switch (field.fieldType) {
      case FieldType.NUMBER: {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
          return Number(value); // n8n 常见字符串数字，自动转换
        }
        throw AppError.badRequest(
          ErrorCodes.INVALID_FIELD_TYPE,
          `字段 "${name}" 需要数字类型，收到: ${JSON.stringify(value)}`,
        );
      }
      case FieldType.STRING:
      case FieldType.SINGLE_LINE_TEXT:
      case FieldType.MULTI_LINE_TEXT: {
        if (typeof value !== 'string') {
          throw AppError.badRequest(
            ErrorCodes.INVALID_FIELD_TYPE,
            `字段 "${name}" 需要字符串类型`,
          );
        }
        const maxLength =
          ((field.config as { maxLength?: number } | null)?.maxLength as number | undefined) ??
          (field.fieldType === FieldType.MULTI_LINE_TEXT ? 10000 : 1024);
        if (value.length > maxLength) {
          throw AppError.badRequest(
            ErrorCodes.INVALID_FIELD_TYPE,
            `字段 "${name}" 长度超过上限 ${maxLength}`,
          );
        }
        return value;
      }
      case FieldType.SINGLE_SELECT: {
        if (typeof value !== 'string') {
          throw AppError.badRequest(ErrorCodes.INVALID_FIELD_TYPE, `字段 "${name}" 需要选项值字符串`);
        }
        const options = ((field.config as { options?: Array<{ label: string; value: string }> } | null)?.options) ?? [];
        if (!options.some((o) => o.value === value)) {
          throw AppError.badRequest(
            ErrorCodes.INVALID_OPTION_VALUE,
            `字段 "${name}" 的值 "${value}" 不在选项列表中（可用: ${options.map((o) => o.value).join(', ')}）`,
          );
        }
        return value;
      }
      case FieldType.MULTI_SELECT: {
        if (!Array.isArray(value)) {
          throw AppError.badRequest(ErrorCodes.INVALID_FIELD_TYPE, `字段 "${name}" 需要选项值数组`);
        }
        const options = ((field.config as { options?: Array<{ label: string; value: string }> } | null)?.options) ?? [];
        const allowed = new Set(options.map((o) => o.value));
        for (const item of value) {
          if (typeof item !== 'string' || !allowed.has(item)) {
            throw AppError.badRequest(
              ErrorCodes.INVALID_OPTION_VALUE,
              `字段 "${name}" 包含非法选项值 "${String(item)}"`,
            );
          }
        }
        return [...new Set(value)];
      }
      case FieldType.DATE: {
        if (typeof value !== 'string') {
          throw AppError.badRequest(ErrorCodes.INVALID_FIELD_TYPE, `字段 "${name}" 需要日期字符串`);
        }
        const showTime = Boolean((field.config as { showTime?: boolean } | null)?.showTime);
        const pattern = showTime
          ? /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/
          : /^\d{4}-\d{2}-\d{2}$/;
        if (!pattern.test(value)) {
          throw AppError.badRequest(
            ErrorCodes.INVALID_DATE_FORMAT,
            `字段 "${name}" 日期格式不正确（期望 ${showTime ? 'YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'}）`,
          );
        }
        const [d, t] = value.split(' ');
        const parsed = Date.parse(`${d}T${t ?? '00:00:00'}`);
        if (Number.isNaN(parsed)) {
          throw AppError.badRequest(ErrorCodes.INVALID_DATE_FORMAT, `字段 "${name}" 不是有效日期`);
        }
        return value;
      }
      default:
        throw AppError.badRequest(
          ErrorCodes.INVALID_FIELD_TYPE,
          `字段 "${name}" 类型不支持写入`,
        );
    }
  }

  /** 校验 match 字段（必须存在、非公式、非多选），仅允许精确匹配 */
  private validateMatchFields(fields: DataField[], match: Record<string, unknown>): void {
    const keys = Object.keys(match);
    if (keys.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, 'match 至少需要一个字段');
    }
    for (const key of keys) {
      const field = fields.find((f) => f.fieldKey === key);
      if (!field) {
        throw AppError.badRequest(ErrorCodes.UNKNOWN_FIELD_IN_DATA, `match 字段 "${key}" 不存在`);
      }
      if (field.fieldType === FieldType.FORMULA) {
        throw AppError.badRequest(
          ErrorCodes.FORMULA_FIELD_READ_ONLY,
          `match 不能使用公式字段 "${field.name}"`,
        );
      }
      if (field.fieldType === FieldType.MULTI_SELECT) {
        throw AppError.badRequest(
          ErrorCodes.VALIDATION_ERROR,
          `match 不能使用多选字段 "${field.name}"`,
        );
      }
      if (match[key] === null || match[key] === undefined || match[key] === '') {
        throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, `match 字段 "${key}" 的值不能为空`);
      }
      // 预校验 match 值类型（与写入校验一致）
      this.validateValue(field, match[key]);
    }
  }

  /** 写入唯一值索引（约束字段部分为空则跳过该约束） */
  private async syncUniqueValues(
    tx: Prisma.TransactionClient,
    constraints: Array<{ id: string; fields: unknown }>,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    for (const constraint of constraints) {
      const raw = constraint.fields;
      if (!Array.isArray(raw)) {
        continue; // 防御：约束字段必须是数组
      }
      const keys = raw as string[];
      const values: Record<string, unknown> = {};
      let skip = false;
      for (const key of keys) {
        const v = data[key];
        if (v === null || v === undefined) {
          skip = true; // 组合约束部分为空 → 跳过（与 MySQL NULL 语义一致）
          break;
        }
        values[key] = v;
      }
      if (skip) {
        continue;
      }
      const hash = this.hashUniqueValues(values);
      await tx.uniqueValue.create({
        data: {
          constraintId: constraint.id,
          recordId,
          valuesHash: hash,
          values: values as unknown as object,
        },
      });
    }
  }

  /** 组合唯一值哈希：基于原始值的规范化 JSON（大小写敏感、类型敏感） */
  private hashUniqueValues(values: Record<string, unknown>): string {
    const canonical = Object.keys(values)
      .sort()
      .map((k) => `${k}=${JSON.stringify(values[k])}`)
      .join('|');
    return createHash('sha256').update(canonical).digest('hex');
  }

  private rethrowUniqueViolation(err: unknown, batch = false): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw AppError.badRequest(
        ErrorCodes.DUPLICATE_UNIQUE_FIELD,
        batch
          ? '批量写入中存在与其他记录重复的唯一值组合，已整体回滚'
          : '唯一约束冲突：相同值的记录已存在（单字段或组合唯一约束）',
      );
    }
  }

  private nullableErrors(errors: Record<string, string>): object | typeof Prisma.DbNull {
    return Object.keys(errors).length > 0 ? (errors as object) : Prisma.DbNull;
  }
}
