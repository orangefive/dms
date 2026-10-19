import { DataField } from '@prisma/client';
import { FormulaService } from '../src/formula/formula.service';
import { FormulaNode } from '../src/formula/formula.types';
import { FormulaValidator } from '../src/formula/validator';
import { QueryCompiler } from '../src/query-engine/query.compiler';
import { TableType } from '../src/common/enums';
import { validateEnv } from '../src/config/env.validation';
import { QueryService } from '../src/query-engine/query.service';

function field(id: string, key: string, type: string, extra: Partial<DataField> = {}): DataField {
  return {
    id,
    tableId: 't1',
    name: key,
    fieldKey: key,
    fieldType: type,
    config: {},
    sortOrder: 1,
    isUnique: false,
    isIndexed: false,
    formulaExpression: null,
    formulaAst: null,
    formulaResultType: null,
    formulaVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  } as DataField;
}

function num(n: number): FormulaNode {
  return { type: 'number', value: n };
}
function ref(fieldId: string, fieldKey = fieldId): FormulaNode {
  return { type: 'field', fieldId, fieldKey, displayName: fieldKey };
}

describe('formula 规范化表达式（括号保真）', () => {
  const validator = new FormulaValidator();

  it('(a + b) * c 规范化后保留括号', () => {
    const fields = [field('fa', 'a', 'NUMBER'), field('fb', 'b', 'NUMBER'), field('fc', 'c', 'NUMBER')];
    const result = validator.validate('({a} + {b}) * {c}', fields);
    expect(result.normalized).toBe('({a} + {b}) * {c}');
  });

  it('a / (b * c) 规范化后保留括号', () => {
    const fields = [field('fa', 'a', 'NUMBER'), field('fb', 'b', 'NUMBER'), field('fc', 'c', 'NUMBER')];
    const result = validator.validate('{a} / ({b} * {c})', fields);
    expect(result.normalized).toBe('{a} / ({b} * {c})');
  });

  it('a - (b - c) 规范化后保留括号', () => {
    const fields = [field('fa', 'a', 'NUMBER'), field('fb', 'b', 'NUMBER'), field('fc', 'c', 'NUMBER')];
    const result = validator.validate('{a} - ({b} - {c})', fields);
    expect(result.normalized).toBe('{a} - ({b} - {c})');
  });

  it('无歧义的表达式不添加多余括号', () => {
    const fields = [field('fa', 'a', 'NUMBER'), field('fb', 'b', 'NUMBER'), field('fc', 'c', 'NUMBER')];
    const result = validator.validate('{a} + {b} * {c}', fields);
    expect(result.normalized).toBe('{a} + {b} * {c}');
  });
});

describe('formula 求值边界与错误传播', () => {
  const service = new FormulaService({} as never);

  it('上游公式错误会传播给下游公式，而不是按 0 计算', () => {
    const fields = [
      field('fb', 'b', 'NUMBER'),
      field('fa', 'a', 'FORMULA', {
        formulaResultType: 'NUMBER',
        formulaAst: { type: 'binary', op: '/', left: num(1), right: ref('fb', 'b') },
      }),
      field('fc', 'c', 'FORMULA', {
        formulaResultType: 'NUMBER',
        formulaAst: { type: 'binary', op: '+', left: ref('fa', 'a'), right: num(1) },
      }),
    ];
    const result = service.computeRecord(fields, { b: 0 });
    expect(result.formulaErrors.a).toBe('FORMULA_DIVIDE_BY_ZERO');
    expect(result.formulaErrors.c).toBe('FORMULA_DEPENDENCY_ERROR');
    expect(result.data.c).toBeNull();
  });

  it('算术溢出（Infinity）被标记为错误，不写入 null 冒充有效值', () => {
    const fields = [
      field('fa', 'a', 'NUMBER'),
      field('fb', 'b', 'NUMBER'),
      field('fc', 'c', 'FORMULA', {
        formulaResultType: 'NUMBER',
        formulaAst: { type: 'binary', op: '*', left: ref('fa', 'a'), right: ref('fb', 'b') },
      }),
    ];
    const result = service.computeRecord(fields, { a: 1e308, b: 10 });
    expect(result.formulaErrors.c).toBe('FORMULA_TYPE_ERROR');
  });

  it('非十进制数字字符串（0x10 / Infinity）不参与计算', () => {
    const fields = [
      field('fa', 'a', 'NUMBER'),
      field('fc', 'c', 'FORMULA', {
        formulaResultType: 'NUMBER',
        formulaAst: { type: 'binary', op: '+', left: ref('fa', 'a'), right: num(1) },
      }),
    ];
    expect(service.computeRecord(fields, { a: '0x10' }).formulaErrors.c).toBe('FORMULA_TYPE_ERROR');
    expect(service.computeRecord(fields, { a: 'Infinity' }).formulaErrors.c).toBe('FORMULA_TYPE_ERROR');
  });

  it('修改后重算会清除已修复字段的历史错误', () => {
    const fields = [
      field('fa', 'a', 'NUMBER'),
      field('fc', 'c', 'FORMULA', {
        formulaResultType: 'NUMBER',
        formulaAst: { type: 'binary', op: '/', left: num(10), right: ref('fa', 'a') },
      }),
    ];
    const failed = service.computeRecord(fields, { a: 0 });
    expect(failed.formulaErrors.c).toBe('FORMULA_DIVIDE_BY_ZERO');
    const fixed = service.computeRecord(fields, { a: 2 }, new Set(['a']), failed.formulaErrors);
    expect(fixed.formulaErrors.c).toBeUndefined();
    expect(fixed.data.c).toBe(5);
  });
});

describe('QueryCompiler 动态标识符防御', () => {
  it('元数据中的非法 fieldKey 不会被拼接进 SQL', () => {
    const malicious = field('fx', "x' OR 1=1 -- ", 'SINGLE_LINE_TEXT');
    const compiler = new QueryCompiler(TableType.SYSTEM, [malicious]);
    expect(() =>
      compiler.compileWhere([{ field: malicious.fieldKey, operator: 'eq', value: 'a' }]),
    ).toThrow(/QUERY_INVALID_IDENTIFIER/);
  });

  it('普通字段生成参数化的 eq 条件', () => {
    const f = field('fa', 'sku', 'SINGLE_LINE_TEXT');
    const compiler = new QueryCompiler(TableType.SYSTEM, [f]);
    expect(() =>
      compiler.compileWhere([{ field: 'sku', operator: 'eq', value: "ABC' OR '1'='1" }]),
    ).not.toThrow();
  });
});

describe('环境变量布尔解析与生产密钥校验', () => {
  const base = {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: 'mysql://root@127.0.0.1:3306/dms',
    CORS_ORIGIN: 'http://localhost:5173',
  };

  it('COOKIE_SECURE="false" 解析为 false（而不是 Boolean("false")=true）', () => {
    const env = validateEnv({ ...base, COOKIE_SECURE: 'false', SWAGGER_ENABLED: 'false' });
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('COOKIE_SECURE="true" 解析为 true', () => {
    expect(validateEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('非法布尔值直接报错', () => {
    expect(() => validateEnv({ ...base, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  it('生产环境拒绝缺失/过短/重复的密钥', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() =>
      validateEnv({
        ...prod,
        JWT_SECRET: 'short',
        JWT_REFRESH_SECRET: 'x'.repeat(40),
        API_KEY_SECRET: 'y'.repeat(40),
      }),
    ).toThrow(/JWT_SECRET/);

    expect(() =>
      validateEnv({
        ...prod,
        JWT_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'a'.repeat(40),
        API_KEY_SECRET: 'y'.repeat(40),
      }),
    ).toThrow(/不同密钥/);
  });
});

describe('query 分页护栏（基于 OFFSET 而非页码）', () => {
  const table = {
    id: 't1',
    projectId: 'p1',
    name: '订单',
    description: null,
    tableType: TableType.SYSTEM,
    externalTableName: null,
    createdBy: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    project: { id: 'p1', name: '项目' },
  };
  const fields = [field('f1', 'sku', 'TEXT')];

  function makeService(): QueryService {
    const prismaStub = {
      dataTable: { findUnique: async () => table },
      dataField: { findMany: async () => fields },
    };
    return new QueryService(prismaStub as never, {} as never);
  }

  it('页码合法但 offset 超上限时拒绝（pageSize 会被放大成百万级 offset）', async () => {
    const service = makeService();
    // page=2001/pageSize=50 恰好是 offset=100000 的边界，允许；再往后一页即拒绝
    await expect(service.query('t1', { page: 2002, pageSize: 50 })).rejects.toMatchObject({
      code: 'QUERY_INVALID_VALUE',
    });
  });

  it('pageSize 超过 500 时拒绝', async () => {
    const service = makeService();
    await expect(service.query('t1', { page: 1, pageSize: 501 })).rejects.toMatchObject({
      code: 'QUERY_INVALID_VALUE',
    });
  });

  it('page 为 0 或非整数时拒绝', async () => {
    const service = makeService();
    await expect(service.query('t1', { page: 0, pageSize: 50 })).rejects.toMatchObject({
      code: 'QUERY_INVALID_VALUE',
    });
    await expect(service.query('t1', { page: 1.5, pageSize: 50 })).rejects.toMatchObject({
      code: 'QUERY_INVALID_VALUE',
    });
  });
});
