/** 公式 AST 节点定义（引用一律使用稳定的 field_id） */
export type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'field'; fieldId: string; fieldKey: string; displayName: string }
  | { type: 'unary'; op: '+' | '-'; operand: FormulaNode }
  | {
      type: 'binary';
      op: '+' | '-' | '*' | '/' | '==' | '!=' | '>' | '>=' | '<' | '<=';
      left: FormulaNode;
      right: FormulaNode;
    }
  | { type: 'call'; name: string; args: FormulaNode[] };

export type FormulaResultType = 'NUMBER' | 'BOOLEAN';

/** 解析结果 */
export interface ParsedFormula {
  ast: FormulaNode;
  /** 规范化的用户可读表达式（使用字段显示名），如 {销售额} - {采购成本} */
  normalized: string;
}

/** 校验通过后的公式 */
export interface ValidatedFormula extends ParsedFormula {
  /** 依赖的 field_id 列表（不含公式自身） */
  dependencies: string[];
  resultType: FormulaResultType;
}

/** 供校验/求值使用的字段元信息 */
export interface FormulaFieldMeta {
  id: string;
  name: string;
  fieldKey: string;
  fieldType: string;
  formulaResultType?: string | null;
}

/** 内置函数白名单 */
export const FORMULA_FUNCTIONS: Readonly<Record<string, { minArgs: number; maxArgs: number }>> = {
  SUM: { minArgs: 1, maxArgs: Infinity },
  AVG: { minArgs: 1, maxArgs: Infinity },
  PRODUCT: { minArgs: 1, maxArgs: Infinity },
  DIVIDE: { minArgs: 2, maxArgs: 2 },
  MAX: { minArgs: 1, maxArgs: Infinity },
  MIN: { minArgs: 1, maxArgs: Infinity },
};

export const FORMULA_FUNCTION_NAMES: readonly string[] = Object.keys(FORMULA_FUNCTIONS);

/** 比较运算符 */
export const COMPARISON_OPS = ['==', '!=', '>', '>=', '<', '<='] as const;
/** 算术运算符 */
export const ARITHMETIC_OPS = ['+', '-', '*', '/'] as const;

export function isComparisonOp(op: string): boolean {
  return (COMPARISON_OPS as readonly string[]).includes(op);
}

export function isArithmeticOp(op: string): boolean {
  return (ARITHMETIC_OPS as readonly string[]).includes(op);
}
