# DMS · 企业多维数据管理系统

一个可自托管的「多维表格 + 开放 API」系统：业务人员用表格管理任意结构的数据，
研发用 **Query DSL** 与 **API Key** 把数据接进自己的系统。
后端 NestJS + Prisma + MySQL，前端 Vue 3 + Element Plus，Docker Compose 一键部署。

> 本仓库在原始版本基础上做了一轮完整审计与工程化加固，问题清单、修复证据与性能实测见
> [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md)。

---

## 为什么值得一看

| 看点 | 说明 | 位置 |
| --- | --- | --- |
| 动态表 + 查询编译器 | 字段定义存元数据、值存 JSON；查询 DSL 编译成 `JSON_EXTRACT` SQL，值全参数化、标识符走白名单 | [`query.compiler.ts`](backend/src/query-engine/query.compiler.ts) |
| 唯一约束的正确实现 | 唯一性下沉到 `(constraint_id, values_hash)` 数据库唯一索引，新增约束时对历史数据分批回填并回滚保护 | [`fields.service.ts`](backend/src/fields/fields.service.ts) |
| 自研受限公式引擎 | 词法 → 递归下降语法树 → 校验（类型/函数白名单/循环引用）→ 拓扑排序求值，**不使用 `eval`** | [`backend/src/formula/`](backend/src/formula) |
| 会话安全的并发正确性 | Refresh Token 原子轮换、并发单飞、重放检测、禁用/降级即时生效 | [`auth.service.ts`](backend/src/auth/auth.service.ts) |
| 有实测依据的性能取舍 | `EXPLAIN ANALYZE` + 1 万行基准，明确「不改什么、为什么」 | [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) §5 |

---

## 架构

```
Vue 3 SPA ──axios(401 单飞刷新)──▶ Nginx ──▶ NestJS ──▶ MySQL 8
                                              │
        ThrottlerGuard → AuthGuard → PermissionsGuard
                          │            │
                   验签 + 查库      实时权限比对
```

详细设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 技术栈

- **后端**：NestJS 11、Prisma 6、MySQL 8、JWT（Access + Refresh 轮换）、class-validator、ExcelJS、Swagger
- **前端**：Vue 3、Vite 6、TypeScript、Element Plus、vxe-table、Pinia
- **质量**：Jest（单元 + 集成）、Vitest、ESLint、vue-tsc、GitHub Actions

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
cp .env.example .env
# 必须修改 .env 中的 JWT_SECRET / JWT_REFRESH_SECRET / API_KEY_SECRET
# 生成：openssl rand -hex 32
# 不改会启动失败（生产配置 fail-fast，见 docs/SECURITY.md）

docker compose up -d --build
docker compose exec backend npm run create-admin   # 交互式创建管理员
```

- 访问：http://localhost:8080
- 接口文档：http://localhost:8080/api/docs

### 方式二：本地开发

前置：Node 20+、MySQL 8。

```bash
# 1. 建库
mysql -uroot -p -e "CREATE DATABASE dms_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. 后端
cd backend
cp .env.example .env        # 填 DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed             # 初始化 ADMIN / DEVELOPER / VIEWER 角色
npm run create-admin        # 创建管理员账号
npm run start:dev           # http://localhost:3000

# 3. 前端（另开终端）
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Windows 可用 `start-dev.ps1`，Linux/macOS 用 `./start-dev.sh` 一键拉起前后端。

---

## 质量门禁

以下数字均为本地实际执行结果，复现方式见 [`docs/TESTING.md`](docs/TESTING.md)：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端 lint / 类型 | `npm run lint && npm run typecheck` | 通过 |
| 后端单元测试 | `npm run test:unit` | **50 通过** |
| 后端集成测试（真实 MySQL） | `npm run test:e2e` | **90 通过** |
| 前端 lint / 类型 | `npm run lint && npm run typecheck` | 通过 |
| 前端单元测试 | `npm run test` | **23 通过** |
| 前端构建 | `npm run build` | 通过 |

CI 覆盖：后端 lint/类型/单测/构建、MySQL 服务上的集成测试、前端 lint/类型/单测/构建、
`docker compose config` 与镜像构建，见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

---

## 核心能力

- **项目 / 表 / 字段**：动态字段（文本、数值、日期、单选、多选、公式），可拖拽排序
- **记录**：增删改查、批量写入、条件 Upsert、批量 Upsert、批量删除
- **查询**：Query DSL（eq / contains / in / gt / gte / lt / lte / isNull 等）、多字段排序、
  分页；过滤与排序全部下推到 MySQL，不做「全表拉取后在 Node 过滤」
- **唯一约束**：单字段唯一 + 组合唯一，并发由数据库唯一索引兜底
- **公式字段**：字段引用、四则运算与括号、函数白名单、依赖自动重算、错误可视化
- **Excel**：模板下载、逐行导入（重复表头检测）、流式导出（防公式注入）
- **外部表**：映射已有 MySQL 物理表，只读查询，列名白名单校验
- **权限**：ADMIN / DEVELOPER / VIEWER 三角色，前端隐藏入口 + 后端强制校验
- **开放 API**：API Key + scope，可独立启停、限定权限，密钥只在创建时明文返回一次
- **审计**：登录/登出/登录失败、增删改、批量导入、权限变更全程留痕

---

## API 速览

所有接口前缀 `/api/v1`，响应统一为 `{ "success": true, "data": ... }`。
认证：`Authorization: Bearer <accessToken>` 或 `X-API-Key: <key>`。

### 精确查询（大小写敏感，不会退化为 LIKE）

```bash
GET /api/v1/tables/{tableId}/records/find?field=sku&value=SKU-001
```

### Query DSL（过滤 / 排序 / 分页均在数据库完成）

```bash
POST /api/v1/tables/{tableId}/records/query
{
  "filters": [
    { "field": "status", "operator": "eq", "value": "已付款" },
    { "field": "amount", "operator": "gte", "value": 100 }
  ],
  "sort": [{ "field": "amount", "order": "desc" }],
  "page": 1,
  "pageSize": 50
}
```

限制：`pageSize ≤ 500`、`offset ≤ 100000`（上限依据见审计报告的性能实测）。

### 写入

```bash
POST   /api/v1/tables/{tableId}/records            # 单条
POST   /api/v1/tables/{tableId}/records/batch      # 批量（事务）
POST   /api/v1/tables/{tableId}/records/upsert     # 按唯一字段 Upsert
PATCH  /api/v1/tables/{tableId}/records/{id}       # 更新（显式 null 表示清空该字段）
DELETE /api/v1/tables/{tableId}/records/{id}
```

### 导入导出

```bash
GET  /api/v1/tables/{tableId}/records/import/template   # 下载模板
POST /api/v1/tables/{tableId}/records/import            # multipart 上传
POST /api/v1/tables/{tableId}/records/export            # 返回 xlsx 流
```

---

## 目录结构

```
backend/
  prisma/            schema + 迁移 + seed
  scripts/           create-admin、benchmark（1 万行性能基准）
  src/
    auth/ users/ roles/ api-keys/      认证与权限
    projects/ tables/ fields/ records/ 业务主体
    query-engine/                      DSL → SQL 编译器
    formula/                           公式引擎（tokenizer/parser/validator/evaluator）
    import/ export/ external/          Excel 与外部表
    audit/                             审计
    common/                            守卫、过滤器、拦截器、校验工具
  test/              单元测试 + 集成测试
frontend/
  src/api/           axios 实例与接口封装
  src/stores/        Pinia
  src/views/         9 个页面
  src/components/    字段管理、公式编辑器、导入、条件筛选等
nginx/               反向代理 + 前端一体化镜像
docs/                审计报告 / 架构 / 测试 / 安全
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) | 审计方法、功能完成度、P0–P3 问题清单、性能实测、明确未做项 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 分层、请求生命周期、动态表模型、编译与公式流水线、部署拓扑 |
| [`docs/TESTING.md`](docs/TESTING.md) | 测试分层与规模、如何运行、覆盖的关键行为、CI 说明 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 认证与会话、RBAC、注入防护、并发一致性、剩余风险 |

---

## 已知限制

- 字段级索引（`isIndexed`）尚未实现：开关只落库，不影响查询计划，设计方案见审计报告 §6。
- 限流为进程内存实现，多副本部署需换 Redis 存储。
- 未设置 CSP；未做浏览器 E2E（前端仅覆盖纯逻辑层）。
- 动态 JSON 存储在百万级大表上需要按字段建索引，当前实测在 1 万行量级表现良好。

## License

UNLICENSED（示例项目，未附带开源许可证）。
