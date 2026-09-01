import { FormulaError } from './formula.errors';

export type TokenType =
  | 'number'
  | 'field' // {字段名}
  | 'ident' // 函数名
  | 'op' // 运算符
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATORS = ['>=', '<=', '==', '!=', '>', '<', '+', '-', '*', '/'];

/**
 * 受限制的公式分词器。
 * 支持：数字、{字段引用}、函数名、运算符、括号、逗号。
 * 任何非法字符立即抛出 FORMULA_SYNTAX_ERROR。
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // 字段引用 {名称}
    if (ch === '{') {
      const start = i;
      i += 1;
      let name = '';
      while (i < n && input[i] !== '}') {
        name += input[i];
        i += 1;
      }
      if (i >= n) {
        throw FormulaError.syntax(`公式第 ${start + 1} 个字符附近：字段引用缺少右花括号 "}"`);
      }
      i += 1; // 跳过 }
      if (name.trim().length === 0) {
        throw FormulaError.syntax(`公式第 ${start + 1} 个字符附近：字段引用不能为空`);
      }
      tokens.push({ type: 'field', value: name.trim(), pos: start });
      continue;
    }

    // 数字
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < n && /[0-9]/.test(input[i + 1]))) {
      const start = i;
      let raw = '';
      while (i < n && /[0-9.]/.test(input[i])) {
        raw += input[i];
        i += 1;
      }
      if (raw.split('.').length > 2 || !/^-?\d*\.?\d+$/.test(raw)) {
        throw FormulaError.syntax(`公式第 ${start + 1} 个字符附近：数字格式错误 "${raw}"`);
      }
      tokens.push({ type: 'number', value: raw, pos: start });
      continue;
    }

    // 标识符（函数名）
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      const start = i;
      let name = '';
      while (i < n && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(input[i])) {
        name += input[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value: name, pos: start });
      continue;
    }

    // 运算符（两字符优先）
    let matched = false;
    for (const op of OPERATORS) {
      if (input.startsWith(op, i)) {
        tokens.push({ type: 'op', value: op, pos: i });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i });
      i += 1;
      continue;
    }

    throw FormulaError.syntax(`公式第 ${i + 1} 个字符附近：存在非法字符 "${ch}"`);
  }

  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}
