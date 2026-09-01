/**
 * DMS 端到端集成测试（真实 MySQL + 完整 Nest 应用）。
 *
 * 覆盖：
 * - Auth / RBAC（登录、JWT、Refresh、ADMIN/DEVELOPER/VIEWER、越权）
 * - Project / Table / Field CRUD、字段类型不可变、唯一字段、组合唯一约束、公式依赖删除保护
 * - Record CRUD / 类型校验 / 非法字段 / 分页 / 排序 / 筛选 / Batch / Upsert
 * - Formula 全链路（计算、链式、循环引用、除零、修改后重算）
 * - 精确查询核心回归（eq 绝不退化为 LIKE、大小写敏感、find/find-one）
 * - API Key 认证与权限范围
 * - EXTERNAL 表注册与查询（只读）
 * - Excel 导出
 * - 审计日志
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoleCode } from '../src/common/enums';

let app: INestApplication;
let prisma: PrismaService;

let adminToken: string;
let developerToken: string;
let viewerToken: string;

let projectId: string;
let tableId: string; // SYSTEM 主测试表

const BASE = '/api/v1';

async function login(username: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`${BASE}/auth/login`)
    .send({ username, password })
    .expect(200);
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createUserAsAdmin(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await request(app.getHttpServer())
    .post(`${BASE}/users`)
    .set(auth(adminToken))
    .send(body)
    .expect(201);
  return res.body.data as { id: string };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  prisma = app.get(PrismaService);

  // 创建三个角色用户（角色已由 seed 初始化）
  const passwordHash = await bcrypt.hash('Test123456', 10);
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.ADMIN } });
  const devRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.DEVELOPER } });
  const viewerRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.VIEWER } });

  await prisma.user.create({
    data: {
      username: 'e2e_admin',
      email: 'e2e_admin@dms.local',
      displayName: 'E2E 管理员',
      passwordHash,
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });
  await prisma.user.create({
    data: {
      username: 'e2e_dev',
      email: 'e2e_dev@dms.local',
      displayName: 'E2E 开发者',
      passwordHash,
      roles: { create: [{ roleId: devRole.id }] },
    },
  });
  await prisma.user.create({
    data: {
      username: 'e2e_viewer',
      email: 'e2e_viewer@dms.local',
      displayName: 'E2E 只读用户',
      passwordHash,
      roles: { create: [{ roleId: viewerRole.id }] },
    },
  });

  adminToken = await login('e2e_admin', 'Test123456');
  developerToken = await login('e2e_dev', 'Test123456');
  viewerToken = await login('e2e_viewer', 'Test123456');

  // 基础项目 + 表 + 字段
  const projectRes = await request(app.getHttpServer())
    .post(`${BASE}/projects`)
    .set(auth(adminToken))
    .send({ name: 'E2E 项目', description: '端到端测试项目' })
    .expect(201);
  projectId = projectRes.body.data.id;

  const tableRes = await request(app.getHttpServer())
    .post(`${BASE}/projects/${projectId}/tables`)
    .set(auth(adminToken))
    .send({ name: '商品表', description: '主测试表', tableType: 'SYSTEM' })
    .expect(201);
  tableId = tableRes.body.data.id;

  // 字段（中文名 + 显式 field_key，保证 n8n/公式引用稳定）
  const fields: Array<Record<string, unknown>> = [
    { name: 'SKU', fieldKey: 'sku', fieldType: 'STRING' },
    { name: 'ERP订单号', fieldKey: 'erp_order_id', fieldType: 'STRING', isUnique: true },
    { name: '商品名称', fieldKey: 'product_name', fieldType: 'SINGLE_LINE_TEXT' },
    {
      name: '店铺',
      fieldKey: 'shop',
      fieldType: 'SINGLE_SELECT',
      config: { options: [{ label: 'Amazon-US', value: 'Amazon-US' }, { label: 'Amazon-DE', value: 'Amazon-DE' }, { label: 'Temu', value: 'Temu' }] },
    },
    { name: '标签', fieldKey: 'tags', fieldType: 'MULTI_SELECT', config: { options: [{ label: 'FBA', value: 'FBA' }, { label: '爆款', value: 'hot' }, { label: '新品', value: 'new' }] } },
    { name: '销量', fieldKey: 'sales', fieldType: 'NUMBER' },
    { name: '采购成本', fieldKey: 'cost', fieldType: 'NUMBER' },
    { name: '上架日期', fieldKey: 'listed_date', fieldType: 'DATE', config: { showTime: false } },
    { name: '利润', fieldKey: 'profit', fieldType: 'FORMULA', formulaExpression: '{销量} - {采购成本}' },
  ];
  for (const f of fields) {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .send(f)
      .expect(201);
  }
});

afterAll(async () => {
  await app.close();
});

describe('Auth / RBAC', () => {
  it('错误密码 → INVALID_CREDENTIALS', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ username: 'e2e_admin', password: 'wrong-pass' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('未认证访问 → 401', async () => {
    await request(app.getHttpServer()).get(`${BASE}/projects`).expect(401);
  });

  it('/auth/me 返回角色与权限', async () => {
    const res = await request(app.getHttpServer()).get(`${BASE}/auth/me`).set(auth(adminToken)).expect(200);
    expect(res.body.data.roles.map((r: { code: string }) => r.code)).toContain('ADMIN');
  });

  it('Refresh Token 轮换（Cookie）', async () => {
    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent
      .post(`${BASE}/auth/login`)
      .send({ username: 'e2e_admin', password: 'Test123456' })
      .expect(200);
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find((c) => c.includes('dms_refresh'));
    expect(refreshCookie).toBeTruthy();
    const refreshRes = await agent.post(`${BASE}/auth/refresh`).expect(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();
    // 旧 refresh token 已轮换，再刷一次应失败（用新的继续成功）
    const refreshAgain = await agent.post(`${BASE}/auth/refresh`).expect(200);
    expect(refreshAgain.body.data.accessToken).toBeTruthy();
  });

  it('修改密码后旧密码失效、新密码可登录', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/auth/change-password`)
      .set(auth(developerToken))
      .send({ oldPassword: 'Test123456', newPassword: 'NewPass123' })
      .expect(201);
    expect(res.body.data.changed).toBe(true);
    // 旧密码登录失败
    await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ username: 'e2e_dev', password: 'Test123456' })
      .expect(401);
    // 新密码登录成功，恢复原密码
    const token = await login('e2e_dev', 'NewPass123');
    await request(app.getHttpServer())
      .post(`${BASE}/auth/change-password`)
      .set(auth(token))
      .send({ oldPassword: 'NewPass123', newPassword: 'Test123456' })
      .expect(201);
  });

  it('VIEWER 越权：不能创建项目/用户/API Key', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/projects`)
      .set(auth(viewerToken))
      .send({ name: '越权项目' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set(auth(viewerToken))
      .send({ username: 'x', email: 'x@dms.local', displayName: 'x', password: 'Test123456', roleCodes: ['VIEWER'] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(viewerToken))
      .send({ name: 'x' })
      .expect(403);
  });

  it('VIEWER 可以查看项目/表/记录并查询', async () => {
    await request(app.getHttpServer()).get(`${BASE}/projects`).set(auth(viewerToken)).expect(200);
    await request(app.getHttpServer()).get(`${BASE}/tables/${tableId}`).set(auth(viewerToken)).expect(200);
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(viewerToken))
      .send({ page: 1, pageSize: 50 })
      .expect(201);
    expect(res.body.data.pagination).toBeTruthy();
  });

  it('DEVELOPER 可以创建项目/表/记录/API Key，但不能管理用户', async () => {
    const proj = await request(app.getHttpServer())
      .post(`${BASE}/projects`)
      .set(auth(developerToken))
      .send({ name: '开发者项目' })
      .expect(201);
    expect(proj.body.data.id).toBeTruthy();
    await request(app.getHttpServer())
      .post(`${BASE}/users`)
      .set(auth(developerToken))
      .send({ username: 'x2', email: 'x2@dms.local', displayName: 'x2', password: 'Test123456', roleCodes: ['VIEWER'] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(developerToken))
      .send({ name: '开发密钥' })
      .expect(201);
  });

  it('用户管理：创建/更新/删除，最后管理员保护', async () => {
    const created = await createUserAsAdmin({
      username: 'temp_user',
      email: 'temp@dms.local',
      displayName: '临时用户',
      password: 'Test123456',
      roleCodes: ['VIEWER'],
    });
    // 不能删除自己
    const me = await request(app.getHttpServer()).get(`${BASE}/auth/me`).set(auth(adminToken)).expect(200);
    await request(app.getHttpServer())
      .delete(`${BASE}/users/${me.body.data.id}`)
      .set(auth(adminToken))
      .expect(400);
    // 删除临时用户
    await request(app.getHttpServer())
      .delete(`${BASE}/users/${created.id}`)
      .set(auth(adminToken))
      .expect(200);

    // 管理员保护：先建 admin2，再把自己降级（还剩 admin2），然后 admin2 不能降级/删除最后一个管理员
    const admin2 = await createUserAsAdmin({
      username: 'admin2',
      email: 'admin2@dms.local',
      displayName: '管理员2',
      password: 'Test123456',
      roleCodes: ['ADMIN'],
    });
    await request(app.getHttpServer())
      .patch(`${BASE}/users/${me.body.data.id}`)
      .set(auth(adminToken))
      .send({ roleCodes: ['VIEWER'] })
      .expect(200); // 还有 admin2，允许降级

    const admin2Token = await login('admin2', 'Test123456');
    // admin2 是最后一个管理员：不能降级自己
    await request(app.getHttpServer())
      .patch(`${BASE}/users/${admin2.id}`)
      .set(auth(admin2Token))
      .send({ roleCodes: ['VIEWER'] })
      .expect(400);
    // 不能删除最后一个管理员
    await request(app.getHttpServer())
      .delete(`${BASE}/users/${admin2.id}`)
      .set(auth(admin2Token))
      .expect(400);
    // 不能删除自己
    await request(app.getHttpServer())
      .delete(`${BASE}/users/${admin2.id}`)
      .set(auth(admin2Token))
      .expect(400);
    // 恢复 e2e_admin 的管理员角色（后续测试继续使用 adminToken）
    await request(app.getHttpServer())
      .patch(`${BASE}/users/${me.body.data.id}`)
      .set(auth(admin2Token))
      .send({ roleCodes: ['ADMIN'] })
      .expect(200);
  });

  it('退出登录后 Refresh Token 失效', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post(`${BASE}/auth/login`).send({ username: 'e2e_viewer', password: 'Test123456' }).expect(200);
    await agent.post(`${BASE}/auth/logout`).expect(200);
    const res = await agent.post(`${BASE}/auth/refresh`).expect(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('字段管理', () => {
  it('字段列表包含公式字段与结果类型', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const profit = res.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'profit');
    expect(profit.fieldType).toBe('FORMULA');
    expect(profit.formulaResultType).toBe('NUMBER');
    expect(profit.formulaAst).toBeTruthy();
  });

  it('字段类型不可变：提交 fieldType 被拒绝', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const sales = res.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'sales');
    await request(app.getHttpServer())
      .patch(`${BASE}/fields/${sales.id}`)
      .set(auth(adminToken))
      .send({ fieldType: 'DATE' })
      .expect(400);
  });

  it('重命名字段不影响 field_key 与公式', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const sales = res.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'sales');
    await request(app.getHttpServer())
      .patch(`${BASE}/fields/${sales.id}`)
      .set(auth(adminToken))
      .send({ name: '销售额' })
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const renamed = after.body.data.find((f: { id: string }) => f.id === sales.id);
    expect(renamed.name).toBe('销售额');
    expect(renamed.fieldKey).toBe('sales');
    // 公式仍可用（引用 id）
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'RENAME_TEST', 'product_name': '重命名测试', sales: 100, cost: 40 } })
      .expect(201);
    // 清理
    const query = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'RENAME_TEST' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`${BASE}/tables/${tableId}/records/${query.body.data.record.id}`)
      .set(auth(adminToken))
      .expect(200);
  });

  it('组合唯一约束：shop + sku', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/constraints`)
      .set(auth(adminToken))
      .send({ name: 'uq_shop_sku', fields: ['shop', 'sku'] })
      .expect(201);
    // 同一 SKU 不同店铺允许
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'COMP-1', shop: 'Amazon-US' } })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'COMP-1', shop: 'Amazon-DE' } })
      .expect(201);
    // 同店铺同 SKU → DUPLICATE_UNIQUE_FIELD
    const dup = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'COMP-1', shop: 'Amazon-US' } })
      .expect(400);
    expect(dup.body.error.code).toBe('DUPLICATE_UNIQUE_FIELD');
  });

  it('唯一字段大小写敏感：ABC123 与 abc123 可并存', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { erp_order_id: 'CaseTest' } })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { erp_order_id: 'casetest' } })
      .expect(201);
  });

  it('字段被公式引用时禁止删除', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const sales = res.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'sales');
    const del = await request(app.getHttpServer())
      .delete(`${BASE}/fields/${sales.id}`)
      .set(auth(adminToken))
      .expect(400);
    expect(del.body.error.code).toBe('FIELD_REFERENCED_BY_FORMULA');
  });

  it('删除公式字段后重算正常', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const profit = res.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'profit');
    // 先创建记录，再删除公式字段（此时无记录引用该公式字段本身）
    const rec = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'DEL-F', sales: 10, cost: 2 } })
      .expect(201);
    const del = await request(app.getHttpServer())
      .delete(`${BASE}/fields/${profit.id}`)
      .set(auth(adminToken))
      .expect(200);
    expect(del.body.data.deleted).toBe(true);
    // 记录中的公式值已被清理
    const get = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/records/${rec.body.data.id}`)
      .set(auth(adminToken))
      .expect(200);
    expect(get.body.data.record.data.profit).toBeUndefined();
    // 重建公式字段，保证后续测试可用（销量已改名为销售额）
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .send({ name: '利润', fieldKey: 'profit', fieldType: 'FORMULA', formulaExpression: '{销售额} - {采购成本}' })
      .expect(201);
  });
});

describe('记录 CRUD 与校验', () => {
  it('创建记录并自动计算公式', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'ABC001', 'product_name': 'Wireless Mouse', shop: 'Amazon-US', tags: ['FBA', 'hot'], sales: 125, cost: 80, listed_date: '2026-08-15' } })
      .expect(201);
    expect(res.body.data.data.profit).toBe(45); // 125 - 80
  });

  it('拒绝未知字段 → UNKNOWN_FIELD_IN_DATA', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'X1', not_exists_field: 'x' } })
      .expect(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD_IN_DATA');
  });

  it('类型校验：NUMBER 拒绝非数字', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'X2', sales: 'not-a-number' } })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_FIELD_TYPE');
  });

  it('选项校验：SINGLE_SELECT 拒绝非法选项', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'X3', shop: 'Wish' } })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_OPTION_VALUE');
  });

  it('日期校验：非法日期被拒绝', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'X4', listed_date: '2026-13-45' } })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_DATE_FORMAT');
  });

  it('禁止直接写 FORMULA 字段 → FORMULA_FIELD_READ_ONLY', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'X5', profit: 999 } })
      .expect(400);
    expect(res.body.error.code).toBe('FORMULA_FIELD_READ_ONLY');
  });

  it('唯一字段重复 → DUPLICATE_UNIQUE_FIELD', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { erp_order_id: 'UNIQ-1' } })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { erp_order_id: 'UNIQ-1' } })
      .expect(400);
    expect(res.body.error.code).toBe('DUPLICATE_UNIQUE_FIELD');
  });

  it('更新记录：公式随依赖字段变化重算', async () => {
    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'ABC001' })
      .expect(201);
    const recordId = find.body.data.record.id;
    const upd = await request(app.getHttpServer())
      .patch(`${BASE}/tables/${tableId}/records/${recordId}`)
      .set(auth(adminToken))
      .send({ data: { cost: 100 } })
      .expect(200);
    expect(upd.body.data.data.profit).toBe(25); // 125 - 100
    expect(upd.body.data.data.sku).toBe('ABC001'); // 其他字段不变
  });

  it('分页与排序在 MySQL 层完成', async () => {
    // 批量造 130 条（分两批，BATCH_INSERT_LIMIT=100）
    const records1 = Array.from({ length: 100 }, (_, i) => ({
      sku: `PAGE-${String(i).padStart(3, '0')}`,
      sales: i,
    }));
    const records2 = Array.from({ length: 30 }, (_, i) => ({
      sku: `PAGE-${String(i + 100).padStart(3, '0')}`,
      sales: i + 100,
    }));
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: records1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: records2 })
      .expect(201);

    const page1 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'starts_with', value: 'PAGE-' }], page: 1, pageSize: 50 })
      .expect(201);
    expect(page1.body.data.records).toHaveLength(50);
    expect(page1.body.data.pagination.total).toBe(130);
    expect(page1.body.data.pagination.totalPages).toBe(3);

    const page3 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'starts_with', value: 'PAGE-' }], page: 3, pageSize: 50 })
      .expect(201);
    expect(page3.body.data.records).toHaveLength(30);

    // 排序 desc
    const sorted = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'starts_with', value: 'PAGE-' }], sort: [{ field: 'sales', order: 'desc' }], page: 1, pageSize: 5 })
      .expect(201);
    expect(sorted.body.data.records[0].data.sales).toBe(129);

    // 超大分页拒绝
    const tooBig = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ page: 1, pageSize: 9999 })
      .expect(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Batch：事务、上限、索引错误定位', async () => {
    // 超过上限（BATCH_INSERT_LIMIT=100）
    const records = Array.from({ length: 101 }, (_, i) => ({ sku: `LIMIT-${i}` }));
    const over = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records })
      .expect(400);
    expect(over.body.error.code).toBe('BATCH_LIMIT_EXCEEDED');

    // 批量中某条非法 → 整体拒绝，并指出索引
    const bad = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: [{ sku: 'BATCH-OK' }, { sku: 'BATCH-BAD', sales: 'oops' }] })
      .expect(400);
    expect(bad.body.error.message).toContain('第 2 条记录');

    // 批量唯一冲突（erp_order_id 唯一）
    const dup = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: [{ erp_order_id: 'BATCH-OK' }, { erp_order_id: 'BATCH-OK' }] })
      .expect(400);
    expect(dup.body.error.code).toBe('DUPLICATE_UNIQUE_FIELD');

    // 合法批量
    const ok = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: [{ sku: 'BATCH-1', sales: 10 }, { sku: 'BATCH-2', sales: 20, cost: 5 }] })
      .expect(201);
    expect(ok.body.data.created).toBe(2);
    // BATCH-2 的公式被计算
    const f2 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'BATCH-2' })
      .expect(201);
    expect(f2.body.data.record.data.profit).toBe(15);
  });

  it('Upsert：精确匹配，存在更新/不存在插入', async () => {
    // 首次 → insert
    const first = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/upsert`)
      .set(auth(adminToken))
      .send({ match: { sku: 'UPS-1' }, data: { sku: 'UPS-1', sales: 100 } })
      .expect(201);
    expect(first.body.data.mode).toBe('insert');

    // 再次 → update
    const second = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/upsert`)
      .set(auth(adminToken))
      .send({ match: { sku: 'UPS-1' }, data: { sales: 300 } })
      .expect(201);
    expect(second.body.data.mode).toBe('update');

    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'UPS-1' })
      .expect(201);
    expect(find.body.data.record.data.sales).toBe(300);

    // 组合匹配（shop + sku 唯一约束）
    const comp = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/upsert`)
      .set(auth(adminToken))
      .send({ match: { shop: 'Amazon-US', sku: 'UPS-COMP' }, data: { sales: 50 } })
      .expect(201);
    expect(comp.body.data.mode).toBe('insert');
    const comp2 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/upsert`)
      .set(auth(adminToken))
      .send({ match: { shop: 'Amazon-US', sku: 'UPS-COMP' }, data: { sales: 60 } })
      .expect(201);
    expect(comp2.body.data.mode).toBe('update');
    const compFind = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'UPS-COMP' })
      .expect(201);
    expect(compFind.body.data.record.data.sales).toBe(60);

    // 非唯一字段匹配多条 → MULTIPLE_RECORDS_FOUND（shop=Temu 有多条则报错）
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'MULTI-1', shop: 'Temu' } })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'MULTI-2', shop: 'Temu' } })
      .expect(201);
    const multi = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/upsert`)
      .set(auth(adminToken))
      .send({ match: { shop: 'Temu' }, data: { sales: 1 } })
      .expect(400);
    expect(multi.body.error.code).toBe('MULTIPLE_RECORDS_FOUND');
  });

  it('Batch Upsert', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-upsert`)
      .set(auth(adminToken))
      .send({
        items: [
          { match: { sku: 'BUPS-1' }, data: { sales: 1 } },
          { match: { sku: 'BUPS-2' }, data: { sales: 2 } },
        ],
      })
      .expect(201);
    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.data.results.map((r: { mode: string }) => r.mode).sort()).toEqual(['insert', 'insert']);

    const again = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-upsert`)
      .set(auth(adminToken))
      .send({ items: [{ match: { sku: 'BUPS-1' }, data: { sales: 100 } }] })
      .expect(201);
    expect(again.body.data.results[0].mode).toBe('update');
  });

  it('批量删除：仅删除本表记录，事务执行', async () => {
    // 准备 3 条待删记录
    const created: string[] = [];
    for (const sku of ['BDEL-1', 'BDEL-2', 'BDEL-3']) {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { sku } })
        .expect(201);
      created.push(res.body.data.id);
    }
    // 空列表 → 拒绝
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-delete`)
      .set(auth(adminToken))
      .send({ ids: [] })
      .expect(400);
    // 删除其中 2 条
    const del = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-delete`)
      .set(auth(adminToken))
      .send({ ids: [created[0], created[1]] })
      .expect(201);
    expect(del.body.data.deleted).toBe(2);
    // 剩余 1 条
    const left = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'BDEL-3' })
      .expect(201);
    expect(left.body.data.record).not.toBeNull();
    // 跨表 id 不影响其他表（用不存在/其他表的 id 再删一次不报错）
    const again = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-delete`)
      .set(auth(adminToken))
      .send({ ids: [created[0], 'cmstqchm00000000000000000'] })
      .expect(201);
    expect(again.body.data.deleted).toBe(0);
    // VIEWER 无删除权限
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch-delete`)
      .set(auth(viewerToken))
      .send({ ids: [created[2]] })
      .expect(403);
  });
});

describe('精确查询核心回归（eq 绝不退化为 LIKE）', () => {
  beforeAll(async () => {
    const values = ['ABC123', 'ABC1234', 'ABC123-US', 'XABC123', 'abc123'];
    for (const v of values) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { sku: v } })
        .expect(201);
    }
  });

  it('eq "ABC123" 大小写敏感 → 只返回 ABC123 一条', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ABC123' }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.records[0].data.sku).toBe('ABC123');
  });

  it('eq "abc123" 小写 → 只返回 abc123（大小写敏感）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'abc123' }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.records[0].data.sku).toBe('abc123');
  });

  it('eq 与 contains 结果必须不同（eq 不是 LIKE）', async () => {
    const eq = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ABC123' }] })
      .expect(201);
    const contains = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'contains', value: 'ABC123' }] })
      .expect(201);
    expect(eq.body.data.pagination.total).toBe(1);
    expect(contains.body.data.pagination.total).toBeGreaterThanOrEqual(4);
  });

  it('eq 无结果 → records: []（不做模糊兜底）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ABC12345' }] })
      .expect(201);
    expect(res.body.data.records).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('数字 eq / 日期 eq / 单选 eq', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'QT-NUM', sales: 888, listed_date: '2026-01-02', shop: 'Temu' } })
      .expect(201);
    const num = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sales', operator: 'eq', value: 888 }] })
      .expect(201);
    expect(num.body.data.pagination.total).toBe(1);
    expect(num.body.data.records[0].data.sku).toBe('QT-NUM');

    const date = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'listed_date', operator: 'eq', value: '2026-01-02' }] })
      .expect(201);
    expect(date.body.data.pagination.total).toBe(1);

    const select = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'shop', operator: 'eq', value: 'Temu' }] })
      .expect(201);
    expect(select.body.data.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it('多字段 AND', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({
        filters: [
          { field: 'shop', operator: 'eq', value: 'Amazon-US' },
          { field: 'sku', operator: 'eq', value: 'COMP-1' },
        ],
        logic: 'AND',
      })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.records[0].data.sku).toBe('COMP-1');
  });

  it('is_null / is_not_null / in', async () => {
    const nul = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'listed_date', operator: 'is_null' }] })
      .expect(201);
    expect(nul.body.data.pagination.total).toBeGreaterThan(0);

    const inn = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'in', value: ['ABC123', 'abc123'] }] })
      .expect(201);
    expect(inn.body.data.pagination.total).toBe(2);
  });

  it('SQL 注入值被参数化 → 无结果而非注入', async () => {
    const evil = "ABC123' OR '1'='1";
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: evil }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(0);
    // LIKE 注入
    const evil2 = "%' OR '1'='1";
    const res2 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'contains', value: evil2 }] })
      .expect(201);
    expect(res2.body.data.pagination.total).toBe(0);
  });

  it('非法字段 / 非法操作符 / NUMBER 禁止 LIKE', async () => {
    const badField = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'not_a_field', operator: 'eq', value: 'x' }] })
      .expect(400);
    expect(badField.body.error.code).toBe('QUERY_INVALID_FIELD');

    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'regex', value: 'x' }] })
      .expect(400);

    const likeOnNumber = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sales', operator: 'contains', value: '8' }] })
      .expect(400);
    expect(likeOnNumber.body.error.code).toBe('QUERY_INVALID_OPERATOR');
  });

  it('find（GET）固定 EXACT 语义', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/records/find?field=sku&value=ABC123`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.data.records).toHaveLength(1);
    expect(res.body.data.records[0].data.sku).toBe('ABC123');
  });

  it('find-one：0 条 → record: null', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'NOT-EXISTS-AT-ALL' })
      .expect(201);
    expect(res.body.data.record).toBeNull();
  });

  it('find-one：多条 → MULTIPLE_RECORDS_FOUND，不擅自取第一条', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'shop', value: 'Temu' })
      .expect(400);
    expect(res.body.error.code).toBe('MULTIPLE_RECORDS_FOUND');
  });

  it('精确查询 + 排序 + 分页', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(adminToken))
      .send({
        filters: [{ field: 'sku', operator: 'starts_with', value: 'PAGE-' }],
        sort: [{ field: 'sales', order: 'asc' }],
        page: 2,
        pageSize: 10,
      })
      .expect(201);
    expect(res.body.data.records).toHaveLength(10);
    expect(res.body.data.records[0].data.sales).toBe(10);
  });
});

describe('公式全链路', () => {
  let formulaTableId: string;

  beforeAll(async () => {
    const tableRes = await request(app.getHttpServer())
      .post(`${BASE}/projects/${projectId}/tables`)
      .set(auth(adminToken))
      .send({ name: '公式表', tableType: 'SYSTEM' })
      .expect(201);
    formulaTableId = tableRes.body.data.id;
    const fields = [
      { name: '销售额', fieldKey: 'sales', fieldType: 'NUMBER' },
      { name: '成本', fieldKey: 'cost', fieldType: 'NUMBER' },
      { name: '利润', fieldKey: 'profit', fieldType: 'FORMULA', formulaExpression: '{销售额} - {成本}' },
      { name: '利润率', fieldKey: 'profit_rate', fieldType: 'FORMULA', formulaExpression: '{利润} / {销售额}' },
    ];
    for (const f of fields) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${formulaTableId}/fields`)
        .set(auth(adminToken))
        .send(f)
        .expect(201);
    }
  });

  it('公式链：利润 → 利润率按依赖顺序计算', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sales: 200, cost: 50 } })
      .expect(201);
    expect(res.body.data.data['profit']).toBe(150);
    expect(res.body.data.data['profit_rate']).toBe(0.75);
  });

  it('直接循环引用 → FORMULA_CIRCULAR_REFERENCE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/fields`)
      .set(auth(adminToken))
      .send({ name: '坏公式', fieldType: 'FORMULA', formulaExpression: '{坏公式} + 1' })
      .expect(400);
    expect(res.body.error.code).toBe('FORMULA_CIRCULAR_REFERENCE');
  });

  it('间接循环 A → B → A 通过真实字段创建验证', async () => {
    // 创建 A = {利润} + 1（合法链）
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/fields`)
      .set(auth(adminToken))
      .send({ name: '循环A', fieldType: 'FORMULA', formulaExpression: '{利润} + 1' })
      .expect(201);
    // 修改 利润 为 {循环A} + 1 → 利润 → 循环A → 利润 成环
    const fields = await request(app.getHttpServer())
      .get(`${BASE}/tables/${formulaTableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const profitField = fields.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'profit');
    const res = await request(app.getHttpServer())
      .patch(`${BASE}/fields/${profitField.id}`)
      .set(auth(adminToken))
      .send({ formulaExpression: '{循环A} + 1' })
      .expect(400);
    expect(res.body.error.code).toBe('FORMULA_CIRCULAR_REFERENCE');
    // 清理：删除 循环A（不引用它则允许）
    const cycleField = fields.body.data.find((f: { name: string }) => f.name === '循环A');
    await request(app.getHttpServer())
      .delete(`${BASE}/fields/${cycleField.id}`)
      .set(auth(adminToken))
      .expect(200);
  });

  it('除以 0 → formula_errors 记录 FORMULA_DIVIDE_BY_ZERO，前端显示 #DIV/0!', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sales: 0, cost: 0 } })
      .expect(201);
    // 利润 = 0-0 = 0；利润率 = 0/0 → 错误
    expect(res.body.data.data['profit']).toBe(0);
    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sales', value: 0 })
      .expect(201);
    const record = find.body.data.record;
    expect(record.formulaErrors['profit_rate']).toBe('FORMULA_DIVIDE_BY_ZERO');
  });

  it('修改公式定义 → 历史记录自动重算', async () => {
    // 先改 成本 → 利润变化
    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sales', value: 200 })
      .expect(201);
    const recordId = find.body.data.record.id;
    await request(app.getHttpServer())
      .patch(`${BASE}/tables/${formulaTableId}/records/${recordId}`)
      .set(auth(adminToken))
      .send({ data: { cost: 80 } })
      .expect(200);

    // 修改利润公式：{销售额} - {成本} * 2
    const fields = await request(app.getHttpServer())
      .get(`${BASE}/tables/${formulaTableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const profitField = fields.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'profit');
    await request(app.getHttpServer())
      .patch(`${BASE}/fields/${profitField.id}`)
      .set(auth(adminToken))
      .send({ formulaExpression: '{销售额} - {成本} * 2' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`${BASE}/tables/${formulaTableId}/records/${recordId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(after.body.data.record.data['profit']).toBe(200 - 80 * 2); // 40
  });

  it('公式校验接口：非法函数/字段/语法返回友好错误', async () => {
    const bad = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/formula/validate`)
      .set(auth(adminToken))
      .send({ expression: 'LOOKUP({销售额})' })
      .expect(201);
    expect(bad.body.data.valid).toBe(false);
    expect(bad.body.data.error.code).toBe('FORMULA_INVALID_FUNCTION');

    const missing = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/formula/validate`)
      .set(auth(adminToken))
      .send({ expression: '{不存在的字段} + 1' })
      .expect(201);
    expect(missing.body.data.valid).toBe(false);
    expect(missing.body.data.error.code).toBe('FORMULA_FIELD_NOT_FOUND');

    const syntax = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/formula/validate`)
      .set(auth(adminToken))
      .send({ expression: '{销售额 +' })
      .expect(201);
    expect(syntax.body.data.valid).toBe(false);
    expect(syntax.body.data.error.code).toBe('FORMULA_SYNTAX_ERROR');
  });

  it('Batch/Upsert 同样计算公式', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records: [{ sales: 10, cost: 4 }, { sales: 100, cost: 60 }] })
      .expect(201);
    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${formulaTableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sales', value: 10 })
      .expect(201);
    expect(find.body.data.record.data['profit']).toBe(2); // 10 - 4*2
  });
});

describe('API Key', () => {
  let apiKey: string;

  it('创建 API Key：完整 Key 仅返回一次，数据库只存 Hash', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(adminToken))
      .send({ name: 'n8n 测试密钥' })
      .expect(201);
    apiKey = res.body.data.key;
    expect(apiKey.startsWith('dms_')).toBe(true);
    expect(apiKey.length).toBeGreaterThan(20);
    // 数据库中没有明文
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.keyHash).not.toContain(apiKey);
    expect(row.keyPrefix).toBe(apiKey.slice(0, 12));
  });

  it('API Key 可查询记录', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(apiKey))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ABC123' }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('API Key 可写记录（默认权限范围）', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(apiKey))
      .send({ data: { sku: 'APIKEY-WRITE' } })
      .expect(201);
  });

  it('受限 API Key：只有 record:read 时写入被拒', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(adminToken))
      .send({ name: '只读密钥', scopes: ['record:read'] })
      .expect(201);
    const readKey = res.body.data.key;
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(readKey))
      .send({ data: { sku: 'NOPE' } })
      .expect(403);
    // 读取正常
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/query`)
      .set(auth(readKey))
      .send({ page: 1, pageSize: 5 })
      .expect(201);
  });

  it('禁用/删除的 API Key → 401', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(adminToken))
      .send({ name: '临时密钥' })
      .expect(201);
    const tempKey = res.body.data.key;
    const keyId = res.body.data.id;

    // 禁用
    await request(app.getHttpServer())
      .patch(`${BASE}/api-keys/${keyId}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${BASE}/projects`)
      .set(auth(tempKey))
      .expect(401);

    // 启用再删除
    await request(app.getHttpServer())
      .patch(`${BASE}/api-keys/${keyId}`)
      .set(auth(adminToken))
      .send({ isActive: true })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${BASE}/api-keys/${keyId}`)
      .set(auth(adminToken))
      .expect(200);
    await request(app.getHttpServer())
      .get(`${BASE}/projects`)
      .set(auth(tempKey))
      .expect(401);
  });

  it('伪造 API Key → 401', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/projects`)
      .set(auth('dms_forged_key_1234567890'))
      .expect(401);
  });
});

describe('EXTERNAL 表', () => {
  let externalTableId: string;

  beforeAll(async () => {
    // 在测试库中创建物理表（模拟公司已有 MySQL 表）；先清理保证可重复执行
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ext_products`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ext_products (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        product_name VARCHAR(255),
        price DECIMAL(10,2),
        stock INT,
        listed_date DATE,
        updated_at DATETIME,
        UNIQUE KEY uk_sku (sku)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO ext_products (sku, product_name, price, stock, listed_date, updated_at) VALUES
      ('EXT-100', 'Product A', 99.90, 10, '2026-01-01', '2026-08-01 10:00:00'),
      ('EXT-200', 'Product B', 199.00, 0, '2026-02-02', '2026-08-02 11:30:00'),
      ('EXT-1000', 'Product C', 299.00, 5, '2026-03-03', '2026-08-03 12:00:00'),
      ('ext-100', 'Product Lower', 9.90, 1, '2026-04-04', '2026-08-04 09:00:00')
    `);
  });

  it('浏览物理表白名单', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/external/tables`)
      .set(auth(adminToken))
      .expect(200);
    const found = res.body.data.find((t: { name: string }) => t.name === 'ext_products');
    expect(found).toBeTruthy();
    expect(found.columnCount).toBe(7);
  });

  it('注册 EXTERNAL 表并自动生成字段', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/projects/${projectId}/tables`)
      .set(auth(adminToken))
      .send({ name: '外部商品表', tableType: 'EXTERNAL', externalTableName: 'ext_products' })
      .expect(201);
    externalTableId = res.body.data.id;
    const fields = await request(app.getHttpServer())
      .get(`${BASE}/tables/${externalTableId}/fields`)
      .set(auth(adminToken))
      .expect(200);
    const keys = fields.body.data.map((f: { fieldKey: string }) => f.fieldKey);
    expect(keys).toContain('sku');
    expect(keys).toContain('price');
    expect(keys).toContain('listed_date');
    expect(keys).toContain('updated_at');
    const price = fields.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'price');
    expect(price.fieldType).toBe('NUMBER');
    const dateField = fields.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'listed_date');
    expect(dateField.fieldType).toBe('DATE');
    const dtField = fields.body.data.find((f: { fieldKey: string }) => f.fieldKey === 'updated_at');
    expect(dtField.config.showTime).toBe(true);
  });

  it('EXTERNAL 精确查询：大小写敏感 eq', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${externalTableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'EXT-100' }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.records[0].data.sku).toBe('EXT-100');
  });

  it('EXTERNAL eq 小写不匹配大写（大小写敏感）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${externalTableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ext-100' }] })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.records[0].data.sku).toBe('ext-100');
  });

  it('EXTERNAL contains / 排序 / 分页', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${externalTableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'product_name', operator: 'contains', value: 'Product' }], sort: [{ field: 'price', order: 'desc' }], page: 1, pageSize: 2 })
      .expect(201);
    expect(res.body.data.pagination.total).toBe(4);
    expect(res.body.data.records).toHaveLength(2);
    expect(res.body.data.records[0].data.sku).toBe('EXT-1000');
  });

  it('EXTERNAL 只读：写入被拒绝', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${externalTableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'EXT-NEW' } })
      .expect(400);
    expect(res.body.error.code).toBe('EXTERNAL_TABLE_READ_ONLY');
    await request(app.getHttpServer())
      .delete(`${BASE}/tables/${externalTableId}/records/whatever`)
      .set(auth(adminToken))
      .expect(400);
  });

  it('EXTERNAL 非法字段名 → 拒绝（DTO 校验或白名单校验均拒绝）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${externalTableId}/records/query`)
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku; DROP TABLE ext_products; --', operator: 'eq', value: 'x' }] })
      .expect(400);
    expect(['VALIDATION_ERROR', 'QUERY_INVALID_FIELD']).toContain(res.body.error.code);
    // 表还在
    const count = await prisma.$queryRaw<Array<{ c: bigint }>>(Prisma.sql`SELECT COUNT(*) AS c FROM ext_products`);
    expect(Number(count[0].c)).toBe(4);
  });

  it('注册不存在的物理表 → EXTERNAL_TABLE_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/projects/${projectId}/tables`)
      .set(auth(adminToken))
      .send({ name: '假外部表', tableType: 'EXTERNAL', externalTableName: 'no_such_table_xyz' })
      .expect(400);
    expect(res.body.error.code).toBe('EXTERNAL_TABLE_NOT_FOUND');
  });
});

describe('Excel 导出', () => {
  it('导出当前筛选结果（流式 xlsx）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/export`)
      .responseType('arraybuffer')
      .set(auth(adminToken))
      .send({ filters: [{ field: 'sku', operator: 'eq', value: 'ABC123' }] })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toContain('.xlsx');
    expect(res.body).toBeInstanceOf(Buffer);
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
    // xlsx 魔数 PK
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('VIEWER 可以导出（业务人员验收项）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/export`)
      .responseType('arraybuffer')
      .set(auth(viewerToken))
      .send({})
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('Excel 导入', () => {
  async function buildXlsx(rows: Array<Array<unknown>>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (const row of rows) {
      ws.addRow(row);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  it('表头匹配（字段名/标识）+ 公式计算 + 失败行报告 + 未匹配列跳过', async () => {
    const buf = await buildXlsx([
      ['SKU', '商品名称', '店铺', '销售额', '采购成本', '利润', '未知列'],
      ['IMP-001', '导入商品A', 'Amazon-US', 100, 30, null, 'x'],
      ['IMP-002', '导入商品B', 'Amazon-DE', '50', 10, null, 'x'],
      ['IMP-003', '导入商品C', 'Temu', 10, 5, null, 'x'],
      ['IMP-BAD', '错误行', 'Wish', 1, 1, null, 'x'],
      [null, null, null, null, null, null, null],
    ]);
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/import`)
      .set(auth(adminToken))
      .attach('file', buf, 'test.xlsx')
      .expect(200);
    expect(res.body.data.imported).toBe(3);
    expect(res.body.data.totalRows).toBe(5);
    // 未匹配列：公式字段 + 未知列
    expect(res.body.data.skippedColumns).toContain('利润');
    expect(res.body.data.skippedColumns).toContain('未知列');
    // 失败行：非法选项
    expect(res.body.data.errors).toHaveLength(1);
    expect(res.body.data.errors[0].row).toBe(5);
    expect(res.body.data.errors[0].code).toBe('INVALID_OPTION_VALUE');

    // 导入的数据公式已计算：IMP-001 → profit = 100 - 30 = 70
    const find = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'IMP-001' })
      .expect(201);
    expect(find.body.data.record.data['product_name']).toBe('导入商品A');
    expect(find.body.data.record.data['profit']).toBe(70);
    // 数字字符串 '50' 被转换
    const find2 = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/find-one`)
      .set(auth(adminToken))
      .send({ field: 'sku', value: 'IMP-002' })
      .expect(201);
    expect(find2.body.data.record.data['sales']).toBe(50);
  });

  it('导入模板下载', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/records/import/template`)
      .set(auth(adminToken))
      .responseType('arraybuffer')
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('非 Excel 文件 → INVALID_EXCEL_FILE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/import`)
      .set(auth(adminToken))
      .attach('file', Buffer.from('this is not excel'), 'bad.xlsx')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_EXCEL_FILE');
  });

  it('缺少文件 → INVALID_EXCEL_FILE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/import`)
      .set(auth(adminToken))
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_EXCEL_FILE');
  });

  it('唯一约束冲突行被报告且不影响其他行', async () => {
    const buf = await buildXlsx([
      ['erp_order_id', 'SKU'],
      ['IMP-UNIQ-1', 'IMP-U1'],
      ['IMP-UNIQ-1', 'IMP-U2'],
    ]);
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/import`)
      .set(auth(adminToken))
      .attach('file', buf, 'uniq.xlsx')
      .expect(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.errors).toHaveLength(1);
    expect(res.body.data.errors[0].code).toBe('DUPLICATE_UNIQUE_FIELD');
  });
});

describe('审计日志', () => {
  it('记录登录/项目/表/字段/记录/API Key 审计', async () => {
    const expectAction = async (action: string): Promise<void> => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/audit-logs?action=${action}&pageSize=5`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.data.logs.length).toBeGreaterThan(0);
      expect(res.body.data.logs[0].action).toBe(action);
      expect(res.body.data.logs[0].ip).toBeTruthy();
    };
    await expectAction('LOGIN');
    await expectAction('PROJECT_CREATE');
    await expectAction('TABLE_CREATE');
    await expectAction('FIELD_CREATE');
    await expectAction('RECORD_CREATE');
    await expectAction('API_KEY_CREATE');
  });

  it('VIEWER 无权查看审计日志', async () => {
    await request(app.getHttpServer()).get(`${BASE}/audit-logs`).set(auth(viewerToken)).expect(403);
  });

  it('每页 300 行可用（pageSize 上限已放开到 500）', async () => {
    const audit = await request(app.getHttpServer())
      .get(`${BASE}/audit-logs?pageSize=300`)
      .set(auth(adminToken))
      .expect(200);
    expect(audit.body.data.pagination.pageSize).toBe(300);
    const users = await request(app.getHttpServer())
      .get(`${BASE}/users?pageSize=300`)
      .set(auth(adminToken))
      .expect(200);
    expect(users.body.data.pagination.pageSize).toBe(300);
  });
});

describe('统一响应格式', () => {
  it('成功: { success: true, data }', async () => {
    const res = await request(app.getHttpServer()).get(`${BASE}/projects`).set(auth(adminToken)).expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('失败: { success: false, error: { code, message } }', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { sku: 'FMT-1', bogus: 1 } })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD_IN_DATA');
    expect(typeof res.body.error.message).toBe('string');
  });
});
