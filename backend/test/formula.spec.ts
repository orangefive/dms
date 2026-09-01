/**
 * 公式引擎单元测试（无数据库）。
 * 覆盖：算术优先级、括号、函数、比较、null 规则、除零、非法公式/字段/函数、循环引用、依赖计算。
 */
import { FormulaValidator } from '../src/formula/validator';
import { FormulaEvaluator } from '../src/formula/evaluator';
import { parseFormula } from '../src/formula/parser';
import { tokenize } from '../src/formula/tokenizer';
import { collectDependencies, topoSortFormulas, affectedFormulas } from '../src/formula/dependency';
import { FormulaError } from '../src/formula/formula.errors';
import { AppError } from '../src/common/errors/app-error';
import { FormulaFieldMeta, FormulaNode } from '../src/formula/formula.types';

const validator = new FormulaValidator();
const evaluator = new FormulaEvaluator();

function makeFields(): FormulaFieldMeta[] {
  return [
    { id: 'f1', name: '销售额', fieldKey: 'sales', fieldType: 'NUMBER' },
    { id: 'f2', name: '采购成本', fieldKey: 'cost', fieldType: 'NUMBER' },
    { id: 'f3', name: '数量', fieldKey: 'qty', fieldType: 'NUMBER' },
    { id: 'f4', name: '单价', fieldKey: 'price', fieldType: 'NUMBER' },
    { id: 'f5', name: '名称', fieldKey: 'name', fieldType: 'SINGLE_LINE_TEXT' },
    { id: 'f6', name: '利润', fieldKey: 'profit', fieldType: 'FORMULA', formulaResultType: 'NUMBER' },
  ];
}

function evalExpression(expression: string, values: Record<string, unknown>): number | boolean {
  const fields = makeFields();
  const validated = validator.validate(expression, fields);
  const resolve = (fieldId: string): unknown => {
    const field = fields.find((f) => f.id === fieldId);
    return field ? (values[field.fieldKey] ?? null) : null;
  };
  return evaluator.evaluate(validated.ast, resolve);
}

function expectFormulaError(expression: string, code: string): void {
  const fields = makeFields();
  try {
    validator.validate(expression, fields);
    throw new Error(`预期抛出 ${code}，但没有抛出: ${expression}`);
  } catch (err) {
    if (err instanceof AppError) {
      expect(err.code).toBe(code);
      return;
    }
    if (err instanceof FormulaError) {
      expect(err.code).toBe(code);
      return;
    }
    throw err;
  }
}

describe('tokenizer', () => {
  it('支持数字、字段引用、运算符、函数', () => {
    const tokens = tokenize('SUM({销售额}, 10) - {数量} * 2');
    const kinds = tokens.map((t) => t.type);
    expect(kinds).toEqual(['ident', 'lparen', 'field', 'comma', 'number', 'rparen', 'op', 'field', 'op', 'number', 'eof']);
  });

  it('非法字符 → FORMULA_SYNTAX_ERROR', () => {
    expect(() => tokenize('1 + $x')).toThrow(FormulaError);
  });

  it('缺少右花括号 → FORMULA_SYNTAX_ERROR', () => {
    expect(() => tokenize('{销售额')).toThrow(FormulaError);
  });

  it('支持中文函数名与中文注释无关的纯数字', () => {
    expect(tokenize('3.14').map((t) => t.type)).toEqual(['number', 'eof']);
  });
});

describe('parser 优先级', () => {
  it('括号 > 乘除 > 加减', () => {
    const ast = parseFormula('(1 + 2) * 3 + 4');
    expect(ast).toEqual({
      type: 'binary',
      op: '+',
      left: {
        type: 'binary',
        op: '*',
        left: { type: 'binary', op: '+', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } },
        right: { type: 'number', value: 3 },
      },
      right: { type: 'number', value: 4 },
    });
  });

  it('缺少右括号 → 语法错误', () => {
    expect(() => parseFormula('(1 + 2')).toThrow(FormulaError);
  });

  it('多余内容 → 语法错误', () => {
    expect(() => parseFormula('1 2')).toThrow(FormulaError);
  });
});

describe('evaluator 算术', () => {
  it('加减乘除与括号优先级', () => {
    expect(evalExpression('1 + 2 * 3', {})).toBe(7);
    expect(evalExpression('(1 + 2) * 3', {})).toBe(9);
    expect(evalExpression('10 - 2 - 3', {})).toBe(5);
    expect(evalExpression('10 / 2 / 5', {})).toBe(1);
    expect(evalExpression('2 * 3 + 4 * 5', {})).toBe(26);
  });

  it('一元负号', () => {
    expect(evalExpression('-5 + 10', {})).toBe(5);
    expect(evalExpression('-(1 + 2) * 3', {})).toBe(-9);
  });

  it('字段引用与 null 视为 0', () => {
    expect(evalExpression('{销售额} - {采购成本}', { sales: 300, cost: 120 })).toBe(180);
    expect(evalExpression('{销售额} + {采购成本}', { sales: 300 })).toBe(300); // cost null → 0
    expect(evalExpression('{销售额} * {数量}', { sales: 5, qty: 0 })).toBe(0);
  });

  it('公式引用公式', () => {
    expect(evalExpression('{利润} + {销售额}', { profit: 180, sales: 300 })).toBe(480);
  });

  it('除以 0 → FORMULA_DIVIDE_BY_ZERO', () => {
    // 校验阶段不抛错（0 值在运行时才知道），求值阶段必须抛标准错误码
    const evaluate = (sales: unknown, qty: unknown): unknown => {
      const ast = validator.validate('{销售额} / {数量}', makeFields()).ast;
      return evaluator.evaluate(ast, (id) => (id === 'f1' ? sales : qty));
    };
    for (const [s, q] of [
      [0, 0],
      [10, 0],
    ] as const) {
      try {
        evaluate(s, q);
        throw new Error('预期抛出 FORMULA_DIVIDE_BY_ZERO');
      } catch (err) {
        expect((err as FormulaError).code).toBe('FORMULA_DIVIDE_BY_ZERO');
      }
    }
  });
});

describe('evaluator 比较', () => {
  it('> < >= <= == != 返回布尔', () => {
    expect(evalExpression('{销售额} > {采购成本}', { sales: 300, cost: 120 })).toBe(true);
    expect(evalExpression('{销售额} < {采购成本}', { sales: 300, cost: 120 })).toBe(false);
    expect(evalExpression('{销售额} >= 300', { sales: 300 })).toBe(true);
    expect(evalExpression('{销售额} <= 299', { sales: 300 })).toBe(false);
    expect(evalExpression('{销售额} == 300', { sales: 300 })).toBe(true);
    expect(evalExpression('{销售额} != 300', { sales: 300 })).toBe(false);
  });

  it('比较结果为 BOOLEAN 类型', () => {
    const validated = validator.validate('{销售额} > {采购成本}', makeFields());
    expect(validated.resultType).toBe('BOOLEAN');
    const validated2 = validator.validate('{销售额} - {采购成本}', makeFields());
    expect(validated2.resultType).toBe('NUMBER');
  });

  it('布尔参与算术 → FORMULA_TYPE_ERROR', () => {
    expectFormulaError('({销售额} > 1) + 1', 'FORMULA_TYPE_ERROR');
  });
});

describe('evaluator 函数', () => {
  it('SUM / AVG / PRODUCT / DIVIDE / MAX / MIN', () => {
    expect(evalExpression('SUM({销售额}, {采购成本}, {数量})', { sales: 1, cost: 2, qty: 3 })).toBe(6);
    expect(evalExpression('SUM(1, 2, 3)', {})).toBe(6);
    expect(evalExpression('AVG(2, 4, 6)', {})).toBe(4);
    expect(evalExpression('PRODUCT(2, 3, 4)', {})).toBe(24);
    expect(evalExpression('DIVIDE(10, 4)', {})).toBe(2.5);
    expect(evalExpression('MAX(3, 9, 5)', {})).toBe(9);
    expect(evalExpression('MIN(3, 9, 5)', {})).toBe(3);
    expect(evalExpression('AVG({销售额}, {采购成本})', { sales: 100 })).toBe(50);
  });

  it('DIVIDE 除 0 → FORMULA_DIVIDE_BY_ZERO', () => {
    const ast = validator.validate('DIVIDE(1, 0)', makeFields()).ast;
    try {
      evaluator.evaluate(ast, () => null);
      throw new Error('预期抛出 FORMULA_DIVIDE_BY_ZERO');
    } catch (err) {
      expect((err as FormulaError).code).toBe('FORMULA_DIVIDE_BY_ZERO');
    }
  });

  it('未知函数 → FORMULA_INVALID_FUNCTION', () => {
    expectFormulaError('FOO(1, 2)', 'FORMULA_INVALID_FUNCTION');
    expectFormulaError('IF(1 > 0, 1, 0)', 'FORMULA_INVALID_FUNCTION');
    expectFormulaError('ROUND(1.5)', 'FORMULA_INVALID_FUNCTION');
  });

  it('参数数量错误 → FORMULA_INVALID_ARGUMENT', () => {
    expectFormulaError('DIVIDE(1)', 'FORMULA_INVALID_ARGUMENT');
    expectFormulaError('SUM()', 'FORMULA_INVALID_ARGUMENT');
  });
});

describe('validator 类型与字段', () => {
  it('非数值字段引用 → FORMULA_TYPE_ERROR', () => {
    expectFormulaError('{名称} + 1', 'FORMULA_TYPE_ERROR');
  });

  it('不存在的字段 → FORMULA_FIELD_NOT_FOUND', () => {
    expectFormulaError('{不存在的字段} + 1', 'FORMULA_FIELD_NOT_FOUND');
  });

  it('空公式 → FORMULA_SYNTAX_ERROR', () => {
    expectFormulaError('   ', 'FORMULA_SYNTAX_ERROR');
  });

  it('规范表达式使用字段显示名', () => {
    const validated = validator.validate('{销售额} - {采购成本}', makeFields());
    expect(validated.normalized).toBe('{销售额} - {采购成本}');
    const v2 = validator.validate('sum({销售额},{数量})', makeFields());
    expect(v2.normalized).toBe('SUM({销售额}, {数量})');
  });

  it('AST 使用稳定 field_id', () => {
    const validated = validator.validate('{销售额} + {数量}', makeFields());
    expect(validated.dependencies.sort()).toEqual(['f1', 'f3']);
    const fields = (validated.ast as FormulaNode & { left: FormulaNode & { fieldId: string } });
    expect(fields.left.fieldId).toBe('f1');
  });

  it('字段重命名不破坏公式（按 id 解析）', () => {
    const fields = makeFields();
    const validated = validator.validate('{销售额} * 2', fields);
    // 重命名后仍能解析
    const renamed = fields.map((f) => (f.id === 'f1' ? { ...f, name: '总销售额' } : f));
    const again = validator.validate('{总销售额} * 2', renamed);
    expect(again.dependencies).toEqual(['f1']);
    // 旧的 AST 仍然有效（依赖 id）
    const resolve = (id: string): unknown => (id === 'f1' ? 5 : null);
    expect(evaluator.evaluate(validated.ast, resolve)).toBe(10);
  });
});

describe('validator 循环引用', () => {
  it('直接循环 A → A', () => {
    const fields = makeFields();
    expect(() =>
      validator.validate('{利润} + 1', fields, 'f6', { f6: ['f1'] }),
    ).toThrowError(/循环引用/);
  });

  it('间接循环 A → B → A', () => {
    const fields = makeFields();
    // f6(利润) 引用 f1；假设 f1 是公式并引用 f6 → 环
    const formulaDeps = { f1: ['f6'] };
    expect(() =>
      validator.validate('{销售额} + 1', fields, 'f6', formulaDeps),
    ).toThrowError(/循环引用/);
  });

  it('无循环时正常通过', () => {
    const fields = makeFields();
    const validated = validator.validate('{销售额} + {数量}', fields, 'f6', { f1: [] });
    expect(validated.resultType).toBe('NUMBER');
  });
});

describe('dependency 拓扑排序', () => {
  const mk = (id: string, deps: string[]): { id: string; fieldKey: string; ast: FormulaNode } => {
    const field = (depId: string): FormulaNode => ({
      type: 'field',
      fieldId: depId,
      fieldKey: depId,
      displayName: depId,
    });
    return {
      id,
      fieldKey: id,
      ast:
        deps.length === 0
          ? { type: 'number', value: 1 }
          : { type: 'binary', op: '+', left: field(deps[0]), right: { type: 'number', value: 1 } },
    };
  };

  it('依赖者排在后面', () => {
    const order = topoSortFormulas([mk('profit', ['sales']), mk('sales', [])]);
    expect(order.indexOf('sales')).toBeLessThan(order.indexOf('profit'));
  });

  it('三层链 A → B → C', () => {
    const order = topoSortFormulas([
      mk('c', ['b']),
      mk('a', []),
      mk('b', ['a']),
    ]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('循环 → FORMULA_CIRCULAR_REFERENCE', () => {
    expect(() => topoSortFormulas([mk('a', ['b']), mk('b', ['a'])])).toThrowError(/循环引用/);
  });

  it('affectedFormulas 只返回受影响的公式', () => {
    const formulas = [
      mk('f1', []),
      mk('f2', ['f1']),
      mk('f3', ['f2']),
      mk('f4', []),
    ];
    const affected = affectedFormulas(formulas, ['f1']);
    expect(affected).toEqual(['f2', 'f3']);
  });

  it('collectDependencies', () => {
    const validated = validator.validate('{销售额} + {数量} * 2', makeFields());
    expect(collectDependencies(validated.ast).sort()).toEqual(['f1', 'f3']);
  });
});
