import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/enums/error-codes';
import { FormulaNode } from './formula.types';

export interface FormulaFieldLike {
  id: string;
  fieldKey: string;
  ast?: FormulaNode | null;
}

/** 从 AST 收集引用的 field_id 列表 */
export function collectDependencies(ast: FormulaNode): string[] {
  const deps = new Set<string>();
  const walk = (node: FormulaNode): void => {
    switch (node.type) {
      case 'field':
        if (node.fieldId) {
          deps.add(node.fieldId);
        }
        break;
      case 'unary':
        walk(node.operand);
        break;
      case 'binary':
        walk(node.left);
        walk(node.right);
        break;
      case 'call':
        node.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return [...deps];
}

/**
 * 构建公式依赖图并做拓扑排序（DFS）。
 * 返回按依赖顺序排列的公式字段 id 列表（被依赖者在前）。
 * 检测到环 → FORMULA_CIRCULAR_REFERENCE。
 */
export function topoSortFormulas(formulas: FormulaFieldLike[]): string[] {
  const depsOf = new Map<string, string[]>();
  for (const f of formulas) {
    depsOf.set(f.id, f.ast ? collectDependencies(f.ast) : []);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  const dfs = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw AppError.badRequest(
        ErrorCodes.FORMULA_CIRCULAR_REFERENCE,
        '公式存在循环引用（A → B → A），请检查公式依赖关系',
      );
    }
    visiting.add(id);
    for (const dep of depsOf.get(id) ?? []) {
      if (depsOf.has(dep)) {
        dfs(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };

  for (const f of formulas) {
    dfs(f.id);
  }
  return order;
}

/**
 * 计算受影响的公式闭包：给定变更字段 id 集合，返回需要重算的公式字段 id 集合
 * （直接依赖 + 下游传递依赖），按拓扑顺序。
 */
export function affectedFormulas(
  formulas: FormulaFieldLike[],
  changedFieldIds: string[],
): string[] {
  const changed = new Set(changedFieldIds);
  const depsOf = new Map<string, string[]>();
  for (const f of formulas) {
    depsOf.set(f.id, f.ast ? collectDependencies(f.ast) : []);
  }

  const affected = new Set<string>();
  const stack = [...changed];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const f of formulas) {
      const deps = depsOf.get(f.id) ?? [];
      if (deps.includes(id) && !affected.has(f.id)) {
        affected.add(f.id);
        stack.push(f.id);
      }
    }
  }

  const order = topoSortFormulas(formulas);
  return order.filter((id) => affected.has(id));
}
