/**
 * 安全回归 E2E：
 * - 禁用账号后旧 Access Token / Refresh Token 立即失效
 * - 角色降级后旧 Access Token 的权限立即收敛
 * - Refresh Token 并发轮换只产生一个有效会话，重放检测撤销全部会话
 * - 唯一约束创建时回填历史数据并拒绝重复值
 * - API Key 不能授予超出创建者自身权限的范围
 * - 记录更新支持显式 null 清空
 * - 数值/日期严格校验
 * - 稳定分页（相同排序键下不重复/不遗漏）
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoleCode } from '../src/common/enums';

const BASE = '/api/v1';
const PASSWORD = 'Test123456';
const PREFIX = 'sec_';

let app: INestApplication;
let prisma: PrismaService;
let adminId: string;
let adminToken: string;

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function refreshCookieOf(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!raw || raw.length === 0) {
    throw new Error('登录响应缺少 set-cookie');
  }
  const cookie = raw.find((c) => c.startsWith('dms_refresh='));
  if (!cookie) {
    throw new Error('登录响应缺少 dms_refresh Cookie');
  }
  return cookie.split(';')[0];
}

async function login(username: string): Promise<{ token: string; cookie: string }> {
  const res = await request(app.getHttpServer())
    .post(`${BASE}/auth/login`)
    .send({ username, password: PASSWORD })
    .expect(200);
  return { token: res.body.data.accessToken as string, cookie: refreshCookieOf(res) };
}

async function createUser(
  username: string,
  roleCode: string,
  isActive = true,
): Promise<{ id: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@sec.local`,
      displayName: username,
      passwordHash,
      isActive,
      roles: { create: [{ roleId: role.id }] },
    },
    select: { id: true },
  });
  return user;
}

async function createProjectAndTable(
  name: string,
  fields: Array<{ name: string; fieldKey: string; fieldType: string; config?: object }>,
): Promise<{ projectId: string; tableId: string; fieldIds: string[] }> {
  const project = await request(app.getHttpServer())
    .post(`${BASE}/projects`)
    .set(auth(adminToken))
    .send({ name: `${PREFIX}${name}-${Date.now()}` })
    .expect(201);
  const projectId = project.body.data.id as string;
  const table = await request(app.getHttpServer())
    .post(`${BASE}/projects/${projectId}/tables`)
    .set(auth(adminToken))
    .send({ name: `${PREFIX}${name}`, tableType: 'SYSTEM' })
    .expect(201);
  const tableId = table.body.data.id as string;
  const fieldIds: string[] = [];
  for (const f of fields) {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/fields`)
      .set(auth(adminToken))
      .send(f)
      .expect(201);
    fieldIds.push(res.body.data.id as string);
  }
  return { projectId, tableId, fieldIds };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  prisma = app.get(PrismaService);

  // 可重复执行：清理上一次安全用例留下的数据
  const oldUsers = await prisma.user.findMany({
    where: { username: { startsWith: PREFIX } },
    select: { id: true },
  });
  const oldIds = oldUsers.map((u) => u.id);
  if (oldIds.length > 0) {
    await prisma.apiKey.deleteMany({ where: { createdById: { in: oldIds } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: oldIds } } });
  }
  await prisma.role.deleteMany({ where: { code: 'SEC_LIMITED', isSystem: false } });

  const admin = await createUser(`${PREFIX}admin`, RoleCode.ADMIN);
  adminId = admin.id;
  adminToken = (await login(`${PREFIX}admin`)).token;
});

afterAll(async () => {
  await app.close();
});

describe('禁用账号与角色变更即时生效', () => {
  it('禁用账号后：旧 Access Token、Refresh Token、重新登录全部失效', async () => {
    const user = await createUser(`${PREFIX}disabled`, RoleCode.DEVELOPER);
    const session = await login(`${PREFIX}disabled`);

    await request(app.getHttpServer())
      .patch(`${BASE}/users/${user.id}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get(`${BASE}/auth/me`)
      .set(auth(session.token))
      .expect(401);
    expect(me.body.error.message).toContain('禁用');

    await request(app.getHttpServer())
      .post(`${BASE}/auth/refresh`)
      .set('Cookie', session.cookie)
      .expect(401);

    const relogin = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ username: `${PREFIX}disabled`, password: PASSWORD })
      .expect(401);
    expect(relogin.body.error.code).toBe('USER_DISABLED');
  });

  it('角色降级后，同一个 Access Token 立即失去写权限', async () => {
    const user = await createUser(`${PREFIX}dev`, RoleCode.DEVELOPER);
    const session = await login(`${PREFIX}dev`);

    await request(app.getHttpServer())
      .post(`${BASE}/projects`)
      .set(auth(session.token))
      .send({ name: `${PREFIX}dev-project` })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`${BASE}/users/${user.id}`)
      .set(auth(adminToken))
      .send({ roleCodes: [RoleCode.VIEWER] })
      .expect(200);

    await request(app.getHttpServer())
      .post(`${BASE}/projects`)
      .set(auth(session.token))
      .send({ name: `${PREFIX}dev-project-2` })
      .expect(403);

    // Token 本身仍有效（只读权限保留）
    await request(app.getHttpServer())
      .get(`${BASE}/projects`)
      .set(auth(session.token))
      .expect(200);
  });
});

describe('Refresh Token 轮换并发与重放', () => {
  it('同一 Refresh Token 并发刷新只允许一个成功，且胜出会话仍可用', async () => {
    const session = await login(`${PREFIX}admin`);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post(`${BASE}/auth/refresh`).set('Cookie', session.cookie),
      request(app.getHttpServer()).post(`${BASE}/auth/refresh`).set('Cookie', session.cookie),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    const winner = a.status === 200 ? a : b;
    const winnerCookie = refreshCookieOf(winner);

    // 胜出请求签发的新 Token 不应被并发失败请求撤销
    const next = await request(app.getHttpServer())
      .post(`${BASE}/auth/refresh`)
      .set('Cookie', winnerCookie)
      .expect(200);
    expect(next.body.data.accessToken).toBeTruthy();
  });

  it('已消费的旧 Token 在宽限期后重放 → 撤销该用户全部会话', async () => {
    const session = await login(`${PREFIX}admin`);

    // 正常轮换一次，旧 Token 被消费
    await request(app.getHttpServer())
      .post(`${BASE}/auth/refresh`)
      .set('Cookie', session.cookie)
      .expect(200);

    // 把 revokedAt 回拨到 31 秒前，模拟“旧 Token 泄漏后被重放”
    const { createHash } = await import('node:crypto');
    const token = session.cookie.slice('dms_refresh='.length);
    const tokenHash = createHash('sha256')
      .update(`${process.env.JWT_REFRESH_SECRET}:${token}`)
      .digest('hex');
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    expect(record).toBeTruthy();
    await prisma.refreshToken.update({
      where: { id: record!.id },
      data: { revokedAt: new Date(Date.now() - 31_000) },
    });

    await request(app.getHttpServer())
      .post(`${BASE}/auth/refresh`)
      .set('Cookie', session.cookie)
      .expect(401);

    const active = await prisma.refreshToken.count({
      where: { userId: adminId, revokedAt: null },
    });
    expect(active).toBe(0);

    // 重新登录恢复管理员会话，供后续用例使用
    adminToken = (await login(`${PREFIX}admin`)).token;
  });
});

describe('唯一约束回填与并发安全', () => {
  it('已有重复值时创建组合唯一约束被拒绝，且不留下半成品约束', async () => {
    const { tableId } = await createProjectAndTable('uniq-fail', [
      { name: '编码', fieldKey: 'code', fieldType: 'SINGLE_LINE_TEXT' },
    ]);
    for (const code of ['A', 'A']) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { code } })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/constraints`)
      .set(auth(adminToken))
      .send({ name: 'uq_code', fields: ['code'] })
      .expect(400);
    expect(res.body.error.code).toBe('UNIQUE_CONSTRAINT_INVALID');

    const constraints = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/constraints`)
      .set(auth(adminToken))
      .expect(200);
    expect(constraints.body.data).toHaveLength(0);
  });

  it('历史值唯一时约束创建成功并回填索引，后续重复写入被拒绝', async () => {
    const { tableId } = await createProjectAndTable('uniq-ok', [
      { name: '编码', fieldKey: 'code', fieldType: 'SINGLE_LINE_TEXT' },
    ]);
    for (const code of ['B', 'C']) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { code } })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/constraints`)
      .set(auth(adminToken))
      .send({ name: 'uq_code', fields: ['code'] })
      .expect(201);

    const values = await prisma.uniqueValue.count({
      where: { constraint: { tableId } },
    });
    expect(values).toBe(2);

    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { code: 'B' } })
      .expect(400);
  });

  it('把已有重复值的字段改为唯一 → 400，且字段状态不被修改', async () => {
    const { tableId, fieldIds } = await createProjectAndTable('uniq-field', [
      { name: '编码', fieldKey: 'code', fieldType: 'SINGLE_LINE_TEXT' },
    ]);
    for (const code of ['D', 'D']) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { code } })
        .expect(201);
    }

    await request(app.getHttpServer())
      .patch(`${BASE}/fields/${fieldIds[0]}`)
      .set(auth(adminToken))
      .send({ isUnique: true })
      .expect(400);

    const field = await prisma.dataField.findUniqueOrThrow({ where: { id: fieldIds[0] } });
    expect(field.isUnique).toBe(false);
  });
});

describe('记录写入边界', () => {
  it('显式 null 可以清空字段值', async () => {
    const { tableId } = await createProjectAndTable('clear', [
      { name: '备注', fieldKey: 'note', fieldType: 'SINGLE_LINE_TEXT' },
    ]);
    const created = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { note: 'hello' } })
      .expect(201);
    const recordId = created.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`${BASE}/tables/${tableId}/records/${recordId}`)
      .set(auth(adminToken))
      .send({ data: { note: null } })
      .expect(200);

    const record = await request(app.getHttpServer())
      .get(`${BASE}/tables/${tableId}/records/${recordId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(record.body.data.record.data.note).toBeUndefined();
  });

  it('数值只接受有限十进制（拒绝 0x10 / Infinity / NaN）', async () => {
    const { tableId } = await createProjectAndTable('number', [
      { name: '数量', fieldKey: 'qty', fieldType: 'NUMBER' },
    ]);

    for (const value of ['0x10', 'Infinity', 'NaN', '12abc']) {
      await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records`)
        .set(auth(adminToken))
        .send({ data: { qty: value } })
        .expect(400);
    }

    const ok = await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { qty: '1e3' } })
      .expect(201);
    expect(ok.body.data.data.qty).toBe(1000);
  });

  it('日期必须是真实日历日期（拒绝 2026-02-31）', async () => {
    const { tableId } = await createProjectAndTable('date', [
      { name: '日期', fieldKey: 'day', fieldType: 'DATE', config: { showTime: false } },
    ]);

    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { day: '2026-02-31' } })
      .expect(400);

    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records`)
      .set(auth(adminToken))
      .send({ data: { day: '2024-02-29' } })
      .expect(201);
  });
});

describe('API Key 权限边界', () => {
  it('不能创建超出自身权限范围的 API Key', async () => {
    const role = await request(app.getHttpServer())
      .post(`${BASE}/roles`)
      .set(auth(adminToken))
      .send({
        code: 'SEC_LIMITED',
        name: '安全测试受限角色',
        permissions: ['project:read', 'api-key:write'],
      })
      .expect(201);

    const user = await prisma.user.create({
      data: {
        username: `${PREFIX}limited`,
        email: `${PREFIX}limited@sec.local`,
        displayName: 'limited',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        roles: { create: [{ roleId: role.body.data.id as string }] },
      },
    });
    expect(user.id).toBeTruthy();
    const session = await login(`${PREFIX}limited`);

    const denied = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(session.token))
      .send({ name: 'escalate', scopes: ['record:write'] })
      .expect(403);
    expect(denied.body.error.message).toContain('超出自身权限');

    const allowed = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(session.token))
      .send({ name: 'readonly', scopes: ['project:read'] })
      .expect(201);
    expect(allowed.body.data.key).toMatch(/^dms_/);
  });

  it('API Key 不能调用 API Key 管理接口', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SEC_LIMITED' } });
    await prisma.user.create({
      data: {
        username: `${PREFIX}keyadmin`,
        email: `${PREFIX}keyadmin@sec.local`,
        displayName: 'keyadmin',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        roles: { create: [{ roleId: role.id }] },
      },
    });
    const session = await login(`${PREFIX}keyadmin`);
    const created = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set(auth(session.token))
      .send({ name: 'self-manage', scopes: ['api-key:write', 'project:read'] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`${BASE}/api-keys`)
      .set('Authorization', `Bearer ${created.body.data.key}`)
      .send({ name: 'from-key' })
      .expect(403);
    expect(res.body.error.message).toContain('网页登录用户');
  });
});

describe('分页稳定性与健康检查', () => {
  it('相同排序键下跨页不重复、不遗漏', async () => {
    const { tableId } = await createProjectAndTable('paging', [
      { name: '分组', fieldKey: 'grp', fieldType: 'SINGLE_LINE_TEXT' },
    ]);
    const records = Array.from({ length: 25 }, () => ({ grp: 'same' }));
    await request(app.getHttpServer())
      .post(`${BASE}/tables/${tableId}/records/batch`)
      .set(auth(adminToken))
      .send({ records })
      .expect(201);

    const ids: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/tables/${tableId}/records/query`)
        .set(auth(adminToken))
        .send({ sort: [{ field: 'grp', order: 'asc' }], page, pageSize: 10 })
        .expect(201);
      ids.push(...res.body.data.records.map((r: { id: string }) => r.id));
    }
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('健康检查包含数据库连通性', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });
});
