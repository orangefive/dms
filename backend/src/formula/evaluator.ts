import { FormulaError } from './formula.errors';
import { FormulaNode } from './formula.types';

export type ValueResolver = (fieldId: string) => unknown;

const DIV_ZERO = 'FORMULA_DIVIDE_BY_ZERO';

/**
 * 受限制的表达式求值器（无 eval / new Function）。
 * 规则：
 * - NUMBER null / undefined / 空字符串在数学计算中视为 0
 * - 除以 0 → 抛出 FORMULA_DIVIDE_BY_ZERO（由调用方物化为错误标记）
 * - 类型错误 → FORMULA_TYPE_ERROR
 */
export class FormulaEvaluator {
  evaluate(node: FormulaNode, resolve: ValueResolver): number | boolean {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'field': {
        const v = resolve(node.fieldId);
        return this.toNumber(v, node.fieldId);
      }
      case 'unary': {
        const operand = this.evaluate(node.operand, resolve);
        const num = this.asNumber(operand, '一元运算符');
        return node.op === '-' ? -num : num;
      }
      case 'binary': {
        if (['==', '!=', '>', '>=', '<', '<='].includes(node.op)) {
          const left = this.asNumber(this.evaluate(node.left, resolve), '比较运算');
          const right = this.asNumber(this.evaluate(node.right, resolve), '比较运算');
          return this.compare(node.op, left, right);
        }
        const left = this.asNumber(this.evaluate(node.left, resolve), '算术运算');
        const right = this.asNumber(this.evaluate(node.right, resolve), '算术运算');
        return this.arithmetic(node.op, left, right);
      }
      case 'call': {
        const args = node.args.map((a) => this.asNumber(this.evaluate(a, resolve), `函数 ${node.name}`));
        return this.callFunction(node.name, args);
      }
      default:
        throw new FormulaError('FORMULA_SYNTAX_ERROR', '未知公式节点');
    }
  }

  private toNumber(v: unknown, fieldId: string): number {
    if (v === null || v === undefined || v === '') {
      return 0; // null 统一视为 0
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new FormulaError('FORMULA_TYPE_ERROR', `字段值不是有限数字（field: ${fieldId}）`);
      }
      return v;
    }
    if (typeof v === 'boolean') {
      throw new FormulaError('FORMULA_TYPE_ERROR', `字段值为布尔类型，不能参与数学计算（field: ${fieldId}）`);
    }
    if (typeof v === 'string') {
      const n = Number(v);
      if (!Number.isNaN(n) && v.trim() !== '') {
        return n;
      }
      throw new FormulaError('FORMULA_TYPE_ERROR', `字段值无法转换为数字（field: ${fieldId}，值: "${v}"）`);
    }
    throw new FormulaError('FORMULA_TYPE_ERROR', `字段值类型不支持数学计算（field: ${fieldId}）`);
  }

  private asNumber(v: number | boolean, where: string): number {
    if (typeof v === 'boolean') {
      throw new FormulaError('FORMULA_TYPE_ERROR', `${where}中混入了布尔值`);
    }
    return v;
  }

  private compare(op: string, left: number, right: number): boolean {
    switch (op) {
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      default:
        throw new FormulaError('FORMULA_SYNTAX_ERROR', `未知比较运算符 ${op}`);
    }
  }

  private arithmetic(op: string, left: number, right: number): number {
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) {
          throw new FormulaError(DIV_ZERO, '除数不能为 0');
        }
        return left / right;
      default:
        throw new FormulaError('FORMULA_SYNTAX_ERROR', `未知算术运算符 ${op}`);
    }
  }

  private callFunction(name: string, args: number[]): number {
    switch (name) {
      case 'SUM':
        return args.reduce((a, b) => a + b, 0);
      case 'AVG':
        return args.reduce((a, b) => a + b, 0) / args.length;
      case 'PRODUCT':
        return args.reduce((a, b) => a * b, 1);
      case 'DIVIDE': {
        const [a, b] = args;
        if (b === 0) {
          throw new FormulaError(DIV_ZERO, '除数不能为 0');
        }
        return a / b;
      }
      case 'MAX':
        return Math.max(...args);
      case 'MIN':
        return Math.min(...args);
      default:
        throw new FormulaError('FORMULA_INVALID_FUNCTION', `未知函数 ${name}`);
    }
  }
}
