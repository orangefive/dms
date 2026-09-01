import { FormulaError } from './formula.errors';
import { FormulaNode } from './formula.types';
import { Token, tokenize } from './tokenizer';

/**
 * 递归下降解析器。
 * 文法（优先级从低到高）：
 *   expr        := comparison
 *   comparison  := additive ( ('=='|'!='|'>'|'>='|'<'|'<=') additive )?
 *   additive    := multiplicative ( ('+'|'-') multiplicative )*
 *   multiplicative := unary ( ('*'|'/') unary )*
 *   unary       := ('+'|'-') unary | primary
 *   primary     := number | field | call | '(' expr ')'
 *   call        := IDENT '(' (expr (',' expr)*)? ')'
 */
export class FormulaParser {
  private tokens: Token[] = [];
  private index = 0;

  parse(expression: string): FormulaNode {
    this.tokens = tokenize(expression);
    this.index = 0;
    if (this.tokens.length === 0) {
      throw FormulaError.syntax('公式为空');
    }
    const node = this.parseExpression();
    if (!this.isEof()) {
      const t = this.peek();
      throw FormulaError.syntax(`公式第 ${t.pos + 1} 个字符附近：存在多余内容 "${t.value}"`);
    }
    return node;
  }

  // ---- helpers ----

  private peek(): Token {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const t = this.tokens[this.index];
    if (t.type !== 'eof') {
      this.index += 1;
    }
    return t;
  }

  private isEof(): boolean {
    return this.peek().type === 'eof';
  }

  private expectOp(op: string): void {
    const t = this.peek();
    if (t.type !== 'op' || t.value !== op) {
      throw FormulaError.syntax(`公式第 ${t.pos + 1} 个字符附近：期望运算符 "${op}"`);
    }
    this.advance();
  }

  // ---- grammar ----

  private parseExpression(): FormulaNode {
    return this.parseComparison();
  }

  private parseComparison(): FormulaNode {
    let left = this.parseAdditive();
    const t = this.peek();
    if (t.type === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.value)) {
      this.advance();
      const right = this.parseAdditive();
      left = {
        type: 'binary',
        op: t.value as '==' | '!=' | '>' | '>=' | '<' | '<=',
        left,
        right,
      };
    }
    return left;
  }

  private parseAdditive(): FormulaNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.advance();
        const right = this.parseMultiplicative();
        left = { type: 'binary', op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMultiplicative(): FormulaNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.advance();
        const right = this.parseUnary();
        left = { type: 'binary', op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): FormulaNode {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', op: t.value, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const t = this.peek();
    if (t.type === 'number') {
      this.advance();
      return { type: 'number', value: Number(t.value) };
    }
    if (t.type === 'field') {
      this.advance();
      return {
        type: 'field',
        fieldId: '',
        fieldKey: '',
        displayName: t.value,
      };
    }
    if (t.type === 'lparen') {
      this.advance();
      const node = this.parseExpression();
      const close = this.peek();
      if (close.type !== 'rparen') {
        throw FormulaError.syntax(
          `公式第 ${close.pos + 1} 个字符附近：缺少右括号 ")" 与左括号匹配`,
        );
      }
      this.advance();
      return node;
    }
    if (t.type === 'ident') {
      this.advance();
      if (this.peek().type !== 'lparen') {
        throw FormulaError.syntax(`公式第 ${t.pos + 1} 个字符附近：函数 "${t.value}" 后必须跟 "("`);
      }
      this.advance();
      const args: FormulaNode[] = [];
      if (this.peek().type !== 'rparen') {
        for (;;) {
          args.push(this.parseExpression());
          const sep = this.peek();
          if (sep.type === 'comma') {
            this.advance();
            continue;
          }
          break;
        }
      }
      const close = this.peek();
      if (close.type !== 'rparen') {
        throw FormulaError.syntax(
          `公式第 ${close.pos + 1} 个字符附近：函数 "${t.value}" 缺少右括号 ")"`,
        );
      }
      this.advance();
      return { type: 'call', name: t.value.toUpperCase(), args };
    }
    throw FormulaError.syntax(
      `公式第 ${t.pos + 1} 个字符附近：此处需要一个数字、字段引用 {字段名} 或函数调用`,
    );
  }
}

export function parseFormula(expression: string): FormulaNode {
  return new FormulaParser().parse(expression);
}

export function parseFormulaSafe(expression: string): FormulaNode | null {
  try {
    return parseFormula(expression);
  } catch {
    return null;
  }
}
