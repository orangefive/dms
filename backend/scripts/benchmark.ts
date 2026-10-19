/**
 * 查询性能基准（约 1 万条记录）。
 *
 * 目标不是刷数字，而是回答三个问题：
 *   1. 当前 JSON 存储 + JSON_EXTRACT 过滤在 1 万行量级下是否可接受？
 *   2. 深分页 / 排序是否出现明显退化？
 *   3. 批量写入吞吐如何？
 *
 * 所有 SQL 都由真实的 QueryCompiler 生成，与线上查询走同一条代码路径。
 *
 * 用法：
 *   DATABASE_URL="mysql://root@127.0.0.1:3307/dms_bench" npx ts-node -T scripts/benchmark.ts
 *   （库需已执行 prisma migrate deploy）
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { QueryCompiler } from '../src/query-engine/query.compiler';
import { TableType } from '../src/common/enums';
import type { QueryFilter, QuerySort } from '../src/query-engine/query.types';

const ROWS = Number(process.env.BENCH_ROWS ?? 10_000);
const BATCH = 500;
const ROUNDS = 5;

const prisma = new PrismaClient();

interface Timing {
  label: string;
  rows: number;
  samples: number[];
}

const timings: Timing[] = [];

function stats(samples: number[]): { min: number; avg: number; max: number } {
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { min, avg, max };
}

async function measure<T>(label: string, fn: () => Promise<T>, countRows: (r: T) => number): Promise<T> {
  const samples: number[] = [];
  let last!: T;
  // 预热一次，排除首次连接/语句缓存的干扰
  last = await fn();
  for (let i = 0; i < ROUNDS; i += 1) {
    const start = process.hrtime.bigint();
    last = await fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  timings.push({ label, rows: countRows(last), samples });
  return last;
}

/**
 * EXPLAIN 输出解析。
 * Prisma 走预处理语句时拿不到列名，会把结果列命名为 f0..f11，
 * 这里按 MySQL 官方列顺序还原成可读字段。
 */
const EXPLAIN_COLUMNS = [
  'id',
  'select_type',
  'table',
  'partitions',
  'type',
  'possible_keys',
  'key',
  'key_len',
  'ref',
  'rows',
  'filtered',
  'Extra',
];

function normalizeExplainRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!('f0' in row)) {
    return row;
  }
  const out: Record<string, unknown> = {};
  EXPLAIN_COLUMNS.forEach((name, i) => {
    out[name] = row[`f${i}`];
  });
  return out;
}

async function explain(sql: Prisma.Sql): Promise<void> {
  const raw = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`EXPLAIN ${sql}`);
  for (const r of raw.map(normalizeExplainRow)) {
    console.log(
      `    access_type=${String(r.type)} index=${String(r.key ?? 'NULL')} estimated_rows=${String(r.rows)} filtered=${String(r.filtered)} extra=${String(r.Extra ?? '')}`,
    );
  }
}

/** EXPLAIN ANALYZE 会真正执行查询，给出实际扫描行数与各阶段耗时 */
async function explainAnalyze(sql: Prisma.Sql): Promise<void> {
  const raw = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`EXPLAIN ANALYZE ${sql}`,
  );
  for (const r of raw) {
    const text = String((r as Record<string, unknown>).f0 ?? Object.values(r)[0] ?? '');
    for (const line of text.split('\n')) {
      console.log(`    ${line.trim()}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`\n=== 准备数据集（${ROWS} 行） ===`);

  // 幂等：先清理上一次的基准数据
  const existing = await prisma.project.findFirst({ where: { name: 'BENCH: 查询性能' } });
  if (existing) {
    await prisma.project.delete({ where: { id: existing.id } });
    console.log('已清理上一次的基准项目');
  }

  const project = await prisma.project.create({
    data: { name: 'BENCH: 查询性能', description: 'benchmark', createdBy: 'benchmark' },
  });
  const table = await prisma.dataTable.create({
    data: {
      projectId: project.id,
      name: '订单明细',
      tableType: TableType.SYSTEM,
      createdBy: 'benchmark',
    },
  });

  const fieldDefs = [
    { fieldKey: 'sku', name: 'SKU', fieldType: 'TEXT' },
    { fieldKey: 'name', name: '商品名称', fieldType: 'TEXT' },
    { fieldKey: 'amount', name: '金额', fieldType: 'NUMBER' },
    { fieldKey: 'qty', name: '数量', fieldType: 'NUMBER' },
    { fieldKey: 'status', name: '状态', fieldType: 'SELECT' },
    { fieldKey: 'created', name: '下单日期', fieldType: 'DATE' },
    { fieldKey: 'total', name: '合计', fieldType: 'FORMULA', formulaExpression: 'amount * qty' },
  ];
  const fields = [];
  for (const [i, def] of fieldDefs.entries()) {
    fields.push(
      await prisma.dataField.create({
        data: {
          tableId: table.id,
          name: def.name,
          fieldKey: def.fieldKey,
          fieldType: def.fieldType,
          sortOrder: i,
          isUnique: def.fieldKey === 'sku',
          formulaExpression: def.formulaExpression ?? null,
        },
      }),
    );
  }

  const statuses = ['待付款', '已付款', '已发货', '已完成', '已取消'];
  const startedInsert = process.hrtime.bigint();
  for (let offset = 0; offset < ROWS; offset += BATCH) {
    const size = Math.min(BATCH, ROWS - offset);
    const rows = Array.from({ length: size }, (_, k) => {
      const i = offset + k;
      const amount = Math.round((i % 1000) * 1.37 * 100) / 100;
      const qty = (i % 20) + 1;
      return {
        tableId: table.id,
        data: {
          sku: `SKU-${String(i).padStart(6, '0')}`,
          name: `商品-${i % 500}`,
          amount,
          qty,
          status: statuses[i % statuses.length],
          created: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          total: Math.round(amount * qty * 100) / 100,
        } as Prisma.InputJsonValue,
        createdBy: 'benchmark',
      };
    });
    await prisma.tableRecord.createMany({ data: rows });
  }
  const insertMs = Number(process.hrtime.bigint() - startedInsert) / 1e6;
  console.log(
    `批量写入 ${ROWS} 行：${insertMs.toFixed(0)} ms（${(ROWS / (insertMs / 1000)).toFixed(0)} 行/秒，每批 ${BATCH}）`,
  );

  const compiler = new QueryCompiler(TableType.SYSTEM, fields);
  const selectPage = (where: Prisma.Sql, orderBy: Prisma.Sql, limit: number, offset: number) =>
    Prisma.sql`SELECT id, data, formula_errors, created_at, updated_at
      FROM table_records
      WHERE table_id = ${table.id} AND ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`;
  const countOf = (where: Prisma.Sql) =>
    Prisma.sql`SELECT COUNT(*) AS total FROM table_records WHERE table_id = ${table.id} AND ${where}`;

  const eqFilter: QueryFilter[] = [{ field: 'sku', operator: 'eq', value: 'SKU-000500' }];
  const likeFilter: QueryFilter[] = [{ field: 'name', operator: 'contains', value: '商品-42' }];
  const rangeFilter: QueryFilter[] = [{ field: 'amount', operator: 'gte', value: 1000 }];
  const comboFilter: QueryFilter[] = [
    { field: 'status', operator: 'eq', value: '已付款' },
    { field: 'amount', operator: 'gte', value: 500 },
  ];
  const amountDesc: QuerySort[] = [{ field: 'amount', order: 'desc' }];

  const cases: Array<{ label: string; filters: QueryFilter[]; sort: QuerySort[]; page: number; pageSize: number }> = [
    { label: '基线：仅 table_id（无 JSON 条件）', filters: [], sort: [], page: 1, pageSize: 50 },
    { label: '精确等值 sku = SKU-000500', filters: eqFilter, sort: [], page: 1, pageSize: 50 },
    { label: '模糊 contains name ~ "商品-42"', filters: likeFilter, sort: [], page: 1, pageSize: 50 },
    { label: '数值区间 amount >= 1000', filters: rangeFilter, sort: [], page: 1, pageSize: 50 },
    { label: '组合条件 + 排序（第 1 页）', filters: comboFilter, sort: amountDesc, page: 1, pageSize: 50 },
    { label: '组合条件 + 排序（第 10 页）', filters: comboFilter, sort: amountDesc, page: 10, pageSize: 50 },
    { label: '深分页（全表 1 万行，offset 9800）', filters: [], sort: amountDesc, page: 197, pageSize: 50 },
  ];

  console.log('\n=== 查询基准（每项预热 1 次 + 采样 5 次） ===');
  for (const c of cases) {
    const where = compiler.compileWhere(c.filters);
    const orderBy = compiler.compileOrderBy(c.sort);
    const offset = (c.page - 1) * c.pageSize;

    const countRes = await measure(
      `${c.label} · COUNT`,
      () => prisma.$queryRaw<Array<{ total: bigint }>>(countOf(where)),
      () => 1,
    );
    const total = Number((countRes as Array<{ total: bigint }>)[0]?.total ?? 0);

    const rows = await measure(
      `${c.label} · SELECT`,
      () => prisma.$queryRaw(selectPage(where, orderBy, c.pageSize, offset)),
      (r) => (r as unknown[]).length,
    );
    const count = (rows as unknown[]).length;

    const countStat = stats(timings[timings.length - 2].samples);
    const selectStat = stats(timings[timings.length - 1].samples);
    console.log(
      `- ${c.label}\n    命中 ${total} 行，返回 ${count} 行 | COUNT 平均 ${countStat.avg.toFixed(1)} ms | SELECT 平均 ${selectStat.avg.toFixed(1)} ms（最慢 ${selectStat.max.toFixed(1)} ms）`,
    );
  }

  console.log('\n=== EXPLAIN 分析 ===');

  console.log('\n[1] 基线：仅按 table_id 过滤（走索引）');
  const baseSql = selectPage(compiler.compileWhere([]), compiler.compileOrderBy([]), 50, 0);
  await explain(baseSql);
  await explainAnalyze(baseSql);

  console.log('\n[2] 等值过滤 sku（JSON 字段，无索引）');
  const eqSql = selectPage(compiler.compileWhere(eqFilter), compiler.compileOrderBy([]), 50, 0);
  await explain(eqSql);
  await explainAnalyze(eqSql);

  console.log('\n[3] 组合条件 + 排序');
  const comboSql = selectPage(
    compiler.compileWhere(comboFilter),
    compiler.compileOrderBy(amountDesc),
    50,
    0,
  );
  await explain(comboSql);
  await explainAnalyze(comboSql);

  console.log('\n[4] 深分页 offset 9800');
  const deepSql = selectPage(compiler.compileWhere([]), compiler.compileOrderBy(amountDesc), 50, 9800);
  await explain(deepSql);
  await explainAnalyze(deepSql);

  console.log('\n=== 汇总（平均毫秒） ===');
  for (const t of timings) {
    const s = stats(t.samples);
    console.log(`${t.label.padEnd(46, ' ')} avg=${s.avg.toFixed(1).padStart(8)}  max=${s.max.toFixed(1).padStart(8)}`);
  }

  console.log('\n基准数据保留在库中（项目名 "BENCH: 查询性能"），重复执行会先自动清理。');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
