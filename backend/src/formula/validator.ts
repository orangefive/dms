import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FormulaError } from './formula.errors';
import { parseFormula } from './parser';
import {
  FormulaFieldMeta,
  FormulaNode,
  FormulaResultType,
  FORMULA_FUNCTIONS,
  ValidatedFormula,
} from './formula.types';

const NUMERIC_TYPES = new Set(['NUMBER']);

/** 运算符优先级：比较 < 加减 < 乘除 */
function binaryPrecedence(op: string): number {
  if (['==', '!=', '>', '>=', '<', '<='].includes(op)) {
    return 1;
  }
  if (op === '+' || op === '-') {
    return 2;
  }
  return 3;
}

/**
 * 公式校验器：
 * - 语法校验（tokenizer + parser）
 * - 字段引用解析（按 显示名 → field_key → field_id 顺序匹配）
 * - 类型检查（算术/比较/函数参数必须为数值）
 * - 函数白名单与参数数量
 * - 结果类型推断（NUMBER / BOOLEAN）
 * - 依赖收集
 */
export class FormulaValidator {
  /**
   * @param expression 用户输入的公式文本，如 {销售额} - {采购成本}
   * @param fields     当前表所有字段元信息
   * @param selfFieldId 当前公式字段自身的 id（用于循环引用检测），可空
   * @param formulaDependencies 表中其它公式字段的依赖图 { fieldId: fieldId[] }
   * @param selfName   当前公式字段的显示名（创建时尚未入库，用于自引用检测）
   */
  validate(
    expression: string,
    fields: FormulaFieldMeta[],
    selfFieldId?: string,
    formulaDependencies?: Record<string, string[]>,
    selfName?: string,
  ): ValidatedFormula {
    let ast: FormulaNode;
    try {
      ast = parseFormula(expression);
    } catch (err) {
      if (err instanceof FormulaError) {
        throw AppError.badRequest(ErrorCodes.FORMULA_SYNTAX_ERROR, err.message);
      }
      throw err;
    }

    const byId = new Map<string, FormulaFieldMeta>();
    const byKey = new Map<string, FormulaFieldMeta>();
    const byName = new Map<string, FormulaFieldMeta>();
    for (const f of fields) {
      byId.set(f.id, f);
      byKey.set(f.fieldKey, f);
      byName.set(f.name, f);
    }

    const dependencies = new Set<string>();
    const resolvedAst = this.resolveFields(ast, byName, byKey, byId, dependencies, selfName);
    const resultType = this.inferType(resolvedAst, byId, expression);

    // 循环引用检测（含当前公式所在链路）
    this.checkCircular(selfFieldId, dependencies, formulaDependencies);

    return {
      ast: resolvedAst,
      normalized: this.render(resolvedAst, byId),
      dependencies: [...dependencies],
      resultType,
    };
  }

  /** 将 {名称} 解析为 field_id 引用；未找到 → FORMULA_FIELD_NOT_FOUND；自引用 → 循环引用 */
  private resolveFields(
    node: FormulaNode,
    byName: Map<string, FormulaFieldMeta>,
    byKey: Map<string, FormulaFieldMeta>,
    byId: Map<string, FormulaFieldMeta>,
    dependencies: Set<string>,
    selfName?: string,
  ): FormulaNode {
    switch (node.type) {
      case 'number':
        return node;
      case 'field': {
        const found =
          byName.get(node.displayName) ??
          byKey.get(node.displayName) ??
          byId.get(node.displayName);
        if (!found) {
          if (selfName && node.displayName === selfName) {
            throw AppError.badRequest(
              ErrorCodes.FORMULA_CIRCULAR_REFERENCE,
              '公式不能引用自身（存在循环引用）',
            );
          }
          throw AppError.badRequest(
            ErrorCodes.FORMULA_FIELD_NOT_FOUND,
            `公式引用了不存在的字段 "${node.displayName}"`,
          );
        }
        if (found.fieldType === 'FORMULA' && found.formulaResultType == null) {
          throw AppError.badRequest(
            ErrorCodes.FORMULA_TYPE_ERROR,
            `公式字段 "${found.name}" 尚未完成初始化，无法被引用`,
          );
        }
        dependencies.add(found.id);
        return { ...node, fieldId: found.id, fieldKey: found.fieldKey };
      }
      case 'unary':
        return { ...node, operand: this.resolveFields(node.operand, byName, byKey, byId, dependencies, selfName) };
      case 'binary':
        return {
          ...node,
          left: this.resolveFields(node.left, byName, byKey, byId, dependencies, selfName),
          right: this.resolveFields(node.right, byName, byKey, byId, dependencies, selfName),
        };
      case 'call':
        return {
          ...node,
          args: node.args.map((a) => this.resolveFields(a, byName, byKey, byId, dependencies, selfName)),
        };
      default:
        return node;
    }
  }

  /** 类型推断 + 检查 */
  private inferType(node: FormulaNode, byId: Map<string, FormulaFieldMeta>, expression: string): FormulaResultType {
    switch (node.type) {
      case 'number':
        return 'NUMBER';
      case 'field': {
        const f = byId.get(node.fieldId);
        if (!f) {
          throw AppError.badRequest(ErrorCodes.FORMULA_FIELD_NOT_FOUND, '公式字段引用丢失');
        }
        if (f.fieldType === 'FORMULA') {
          const rt = f.formulaResultType;
          if (rt === 'NUMBER' || rt === 'BOOLEAN') {
            return rt;
          }
        }
        if (NUMERIC_TYPES.has(f.fieldType)) {
          return 'NUMBER';
        }
        throw AppError.badRequest(
          ErrorCodes.FORMULA_TYPE_ERROR,
          `公式只能引用 NUMBER 类型字段或返回 NUMBER/BOOLEAN 的公式字段，字段 "${f.name}" 类型为 ${f.fieldType}`,
        );
      }
      case 'unary': {
        const t = this.inferType(node.operand, byId, expression);
        this.requireNumber(t, node.op === '-' ? '负号' : '正号');
        return 'NUMBER';
      }
      case 'binary': {
        if (['==', '!=', '>', '>=', '<', '<='].includes(node.op)) {
          const l = this.inferType(node.left, byId, expression);
          const r = this.inferType(node.right, byId, expression);
          this.requireNumber(l, '比较运算符左侧');
          this.requireNumber(r, '比较运算符右侧');
          return 'BOOLEAN';
        }
        const l = this.inferType(node.left, byId, expression);
        const r = this.inferType(node.right, byId, expression);
        this.requireNumber(l, '算术运算符左侧');
        this.requireNumber(r, '算术运算符右侧');
        return 'NUMBER';
      }
      case 'call': {
        const spec = FORMULA_FUNCTIONS[node.name];
        if (!spec) {
          throw AppError.badRequest(
            ErrorCodes.FORMULA_INVALID_FUNCTION,
            `公式使用了未知函数 "${node.name}"（仅支持: ${Object.keys(FORMULA_FUNCTIONS).join(', ')}）`,
          );
        }
        if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
          const expect =
            spec.minArgs === spec.maxArgs
              ? `${spec.minArgs} 个参数`
              : `至少 ${spec.minArgs} 个参数`;
          throw AppError.badRequest(
            ErrorCodes.FORMULA_INVALID_ARGUMENT,
            `函数 ${node.name} 需要 ${expect}，实际传入了 ${node.args.length} 个`,
          );
        }
        for (const arg of node.args) {
          const t = this.inferType(arg, byId, expression);
          this.requireNumber(t, `函数 ${node.name} 的参数`);
        }
        return 'NUMBER';
      }
      default:
        throw AppError.badRequest(ErrorCodes.FORMULA_SYNTAX_ERROR, '公式语法错误');
    }
  }

  private requireNumber(t: FormulaResultType, where: string): void {
    if (t !== 'NUMBER') {
      throw AppError.badRequest(
        ErrorCodes.FORMULA_TYPE_ERROR,
        `${where}必须是数值类型（BOOLEAN 只能作为最终比较结果）`,
      );
    }
  }

  /** 循环引用检测：DFS 从当前公式出发 */
  private checkCircular(
    selfFieldId: string | undefined,
    dependencies: Set<string>,
    formulaDependencies: Record<string, string[]> | undefined,
  ): void {
    if (!selfFieldId) {
      return;
    }
    const graph = new Map<string, string[]>();
    for (const depId of dependencies) {
      graph.set(depId, formulaDependencies?.[depId] ?? []);
    }
    // 当前公式依赖集合中，若某个依赖链能回到 selfFieldId 即循环
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): boolean => {
      if (id === selfFieldId) {
        return true;
      }
      if (visited.has(id)) {
        return false;
      }
      visiting.add(id);
      for (const next of graph.get(id) ?? []) {
        if (visiting.has(next) || dfs(next)) {
          return true;
        }
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    for (const depId of dependencies) {
      if (dfs(depId)) {
        throw AppError.badRequest(
          ErrorCodes.FORMULA_CIRCULAR_REFERENCE,
          '公式存在循环引用（A → B → A），请检查公式依赖关系',
        );
      }
    }
  }

  /** 从 AST 渲染规范表达式（字段用显示名），按优先级补全括号，保证可被重新解析为同一语义 */
  render(node: FormulaNode, byId: Map<string, FormulaFieldMeta>, parentPrecedence = 0): string {
    switch (node.type) {
      case 'number':
        return String(node.value);
      case 'field': {
        const f = byId.get(node.fieldId);
        return `{${f ? f.name : node.displayName}}`;
      }
      case 'unary': {
        const operand = this.render(node.operand, byId, 4);
        const text = `${node.op}${operand}`;
        return 3 < parentPrecedence ? `(${text})` : text;
      }
      case 'binary': {
        const precedence = binaryPrecedence(node.op);
        const left = this.render(node.left, byId, precedence);
        // 减号/除号的右侧同优先级也要加括号：a - (b - c)、a / (b * c)
        const rightRequiresParens = node.op === '-' || node.op === '/';
        const right = this.render(node.right, byId, precedence + (rightRequiresParens ? 1 : 0));
        const text = `${left} ${node.op} ${right}`;
        return precedence < parentPrecedence ? `(${text})` : text;
      }
      case 'call':
        return `${node.name}(${node.args.map((a) => this.render(a, byId, 0)).join(', ')})`;
      default:
        return '';
    }
  }
}
