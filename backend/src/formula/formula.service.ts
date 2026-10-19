import { Injectable } from '@nestjs/common';
import { DataField, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FormulaEvaluator } from './evaluator';
import { FormulaError } from './formula.errors';
import { FormulaValidator } from './validator';
import {
  affectedFormulas,
  collectDependencies,
  topoSortFormulas,
} from './dependency';
import { FormulaFieldMeta, FormulaNode, ValidatedFormula } from './formula.types';

export interface FormulaComputationResult {
  data: Record<string, unknown>;
  formulaErrors: Record<string, string>;
}

/**
 * 公式服务：
 * - 表达式校验（语法/类型/函数/循环引用）
 * - 记录计算（依赖拓扑序，仅重算受影响公式）
 * - 公式修改后的历史数据分批重算
 */
@Injectable()
export class FormulaService {
  private readonly validator = new FormulaValidator();
  private readonly evaluator = new FormulaEvaluator();

  constructor(private readonly prisma: PrismaService) {}

  /** 校验公式表达式（供字段创建/编辑与前端实时校验使用） */
  async validateExpression(
    tableId: string,
    expression: string,
    selfFieldId?: string,
    selfName?: string,
  ): Promise<ValidatedFormula> {
    if (!expression || expression.trim().length === 0) {
      throw AppError.badRequest(ErrorCodes.FORMULA_SYNTAX_ERROR, '公式表达式不能为空');
    }
    const fields = await this.prisma.dataField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
    const metas = fields.map(toFormulaMeta);
    const formulaDeps = this.buildFormulaDependencyMap(fields.filter((f) => f.id !== selfFieldId));
    return this.validator.validate(expression, metas, selfFieldId, formulaDeps, selfName);
  }

  /**
   * 计算一条记录的全部公式，结果物化进 data（写入 data[fieldKey]）。
   * @param fields 表的所有字段（按 sortOrder）
   * @param data   记录的字段值（field_key → value）
   * @param changedKeys 本次变更的 field_key 集合；为空则计算全部公式
   */
  computeRecord(
    fields: DataField[],
    data: Record<string, unknown>,
    changedKeys?: Set<string>,
    previousErrors?: Record<string, string> | null,
  ): FormulaComputationResult {
    const formulaFields = fields.filter((f) => f.fieldType === 'FORMULA');
    if (formulaFields.length === 0) {
      return { data, formulaErrors: {} };
    }

    const formulaById = new Map<string, DataField>();
    const fieldKeyById = new Map<string, string>();
    const fieldIdByKey = new Map<string, string>();
    for (const f of fields) {
      fieldKeyById.set(f.id, f.fieldKey);
      fieldIdByKey.set(f.fieldKey, f.id);
      if (f.fieldType === 'FORMULA') {
        formulaById.set(f.id, f);
      }
    }

    const like: FormulaFieldLike_[] = formulaFields.map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey,
      ast: (f.formulaAst ?? null) as FormulaNode | null,
    }));

    let order: string[];
    if (changedKeys && changedKeys.size > 0) {
      const changedIds = [...changedKeys]
        .map((k) => fieldIdByKey.get(k))
        .filter((id): id is string => Boolean(id));
      order = affectedFormulas(like, changedIds);
    } else {
      order = topoSortFormulas(like);
    }

    const out = { ...data };
    // 保留未参与本次重算的历史错误，避免依赖它的公式把错误值当成 0
    const formulaErrors: Record<string, string> = {};
    if (previousErrors) {
      for (const [key, code] of Object.entries(previousErrors)) {
        if (formulaById.has(fieldIdByKey.get(key) ?? '')) {
          formulaErrors[key] = code;
        }
      }
    }

    for (const formulaId of order) {
      const f = formulaById.get(formulaId);
      if (!f || !f.formulaAst) {
        continue;
      }
      const ast = f.formulaAst as FormulaNode;
      const resolve = (fieldId: string): unknown => {
        const key = fieldKeyById.get(fieldId);
        if (!key) {
          return null;
        }
        if (formulaErrors[key]) {
          throw new FormulaError(
            ErrorCodes.FORMULA_DEPENDENCY_ERROR,
            `依赖的公式字段 "${key}" 计算失败（${formulaErrors[key]}）`,
          );
        }
        return out[key] ?? null;
      };
      try {
        const value = this.evaluator.evaluate(ast, resolve);
        out[f.fieldKey] = value;
        delete formulaErrors[f.fieldKey];
      } catch (err) {
        const code =
          err instanceof Error && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
            ? ((err as { code: string }).code)
            : ErrorCodes.FORMULA_TYPE_ERROR;
        out[f.fieldKey] = null;
        formulaErrors[f.fieldKey] = code;
      }
    }

    return {
      data: out,
      formulaErrors:
        Object.keys(formulaErrors).length > 0 ? formulaErrors : {},
    };
  }

  /**
   * 重算表中全部记录（或指定公式字段），分批执行。
   * @returns { total, processed, failed, errors }
   */
  async recalculateTable(
    tableId: string,
    fieldId?: string,
    batchSize = 500,
  ): Promise<{ total: number; processed: number; failed: number }> {
    const fields = await this.prisma.dataField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
    const formulaFields = fields.filter((f) => f.fieldType === 'FORMULA');
    if (fieldId) {
      const target = formulaFields.find((f) => f.id === fieldId);
      if (!target) {
        throw AppError.badRequest(ErrorCodes.FIELD_NOT_FOUND, '公式字段不存在');
      }
    }
    if (formulaFields.length === 0) {
      return { total: 0, processed: 0, failed: 0 };
    }

    const total = await this.prisma.tableRecord.count({ where: { tableId } });
    let processed = 0;
    const failed = 0;

    // 分页游标（id 排序）分批处理，避免一次性加载全表
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.tableRecord.findMany({
        where: { tableId },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, data: true },
      });
      if (batch.length === 0) {
        break;
      }
      cursor = batch[batch.length - 1].id;

      const updates: { id: string; data: unknown; formulaErrors: unknown }[] = [];
      for (const record of batch) {
        const raw = (record.data ?? {}) as Record<string, unknown>;
        const result = this.computeRecord(fields, raw);
        updates.push({
          id: record.id,
          data: result.data,
          formulaErrors: Object.keys(result.formulaErrors).length
            ? result.formulaErrors
            : Prisma.DbNull,
        });
      }
      // 分批事务写入
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.tableRecord.update({
            where: { id: u.id },
            data: {
              data: u.data as object,
              formulaErrors: u.formulaErrors as object | typeof Prisma.DbNull,
            },
          }),
        ),
      );
      processed += updates.length;
      if (batch.length < batchSize) {
        break;
      }
    }

    return { total, processed, failed };
  }

  /** 检查字段是否被公式引用，返回引用它的公式字段列表 */
  async findFormulaReferences(tableId: string, fieldKey: string): Promise<DataField[]> {
    const allFields = await this.prisma.dataField.findMany({ where: { tableId } });
    const target = allFields.find((f) => f.fieldKey === fieldKey);
    if (!target) {
      return [];
    }
    return allFields.filter((f) => {
      if (f.fieldType !== 'FORMULA' || !f.formulaAst) {
        return false;
      }
      const deps = collectDependencies(f.formulaAst as FormulaNode);
      return deps.includes(target.id);
    });
  }

  /** 构建 { formulaFieldId: [依赖的公式字段 id] } 映射 */
  private buildFormulaDependencyMap(formulaFields: DataField[]): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const f of formulaFields) {
      if (!f.formulaAst) {
        map[f.id] = [];
        continue;
      }
      map[f.id] = collectDependencies(f.formulaAst as FormulaNode);
    }
    return map;
  }
}

interface FormulaFieldLike_ {
  id: string;
  fieldKey: string;
  ast: FormulaNode | null;
}

function toFormulaMeta(f: DataField): FormulaFieldMeta {
  return {
    id: f.id,
    name: f.name,
    fieldKey: f.fieldKey,
    fieldType: f.fieldType,
    formulaResultType: f.formulaResultType,
  };
}
