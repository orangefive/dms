# 多维数据管理系统（DMS）

一个通用、自托管的**多维数据管理系统**：将 MySQL 中的数据以类似现代多维表格的方式可视化展示与管理，并通过 REST API 供自动化脚本、CI/CD 或其他内部系统进行精确查询、批量写入与 Upsert。

系统面向两类使用者：

- **业务人员**：无需了解数据库，即可浏览项目与数据表、按字段精确/模糊查询、筛选、排序、翻页，并导出 Excel。
- **开发与自动化**：通过统一的 REST API（API 密钥认证）完成数据的增删改查、批量写入、精确 Upsert 与公式计算。

## 1. 功能总览

| 角色 | 能力 |
| --- | --- |
| 只读用户（VIEWER） | 登录、浏览项目/数据表、查看记录（每页 300 行）、精确查询、包含搜索、多条件筛选、排序、Excel 导出 |
| 开发者（DEVELOPER） | 项目/数据表/字段/记录 CRUD、公式（FORMULA）、API 密钥、外部表注册、Query DSL、批量写入、Upsert、Excel 导入/导出 |
| 管理员（ADMIN） | 全部能力 + 用户管理、角色与权限管理、API 密钥管理、审计日志 |
| API / 自动化脚本 | API 密钥认证：精确查询、Find / Find-One、Insert / Update / Delete、Batch、Exact Upsert（含组合字段匹配） |

核心设计：

- **Excel 导入**：数据表工具栏「导入 Excel」上传 .xlsx，第一行表头按「字段标识 / 字段名称」自动匹配数据表字段；单选/多选支持选项值与显示名两种写法；未匹配列与公式列自动跳过并提示；逐行校验（类型/选项/日期/唯一约束/公式），失败行收集错误不影响其余行。
- **批量删除**：勾选记录后「批量删除（N）」一键删除（仅限本表记录，事务执行，需删除权限）。
- **分页（每页 300 行）**：数据表每页固定 300 行；翻页按钮（上一页/下一页/页码）始终显示在最后一行数据下方，数据满 300 行自动新增一页，单页时按钮自动禁用。
- **精确查询（EXACT）与包含查询（CONTAINS）严格分离**：`eq` 永远实现为大小写敏感精确匹配（BINARY / JSON 精确比较），绝不退化为 LIKE；无结果返回 `records: []`，不自动模糊兜底。
- **SYSTEM 动态表**：元数据 + JSON Record（不执行 CREATE TABLE）；**EXTERNAL 物理表**：通过 information_schema 白名单注册、只读查询。
- **FORMULA 公式引擎**：受限制解析器（无 eval / new Function），支持 `+-*/()`、比较、SUM/AVG/PRODUCT/DIVIDE/MAX/MIN，依赖图拓扑排序计算、循环引用检测、结果物化存储、定义修改后自动重算历史数据。
- **唯一约束**：单字段 `is_unique` + 组合唯一约束（如 shop + sku），数据库级原子强校验，大小写敏感。
- **统一响应**：成功 `{ success: true, data }` / 失败 `{ success: false, error: { code, message } }`。

## 2. 架构

```
┌─────────────┐      ┌──────────────────────────────┐
│  浏览器/Vue3 │ ───▶ │  nginx（静态资源 + 反向代理）  │
└─────────────┘      └──────────────┬───────────────┘
                                    ▼
                    ┌──────────────────────────────┐
                    │  NestJS 后端（模块化单体）      │
                    │  Auth/RBAC · Projects/Tables │
                    │  Fields · Records · Query DSL│
                    │  Formula · ApiKeys · Audit   │
                    │  Export(ExcelJS) · External  │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  MySQL 8.x（Prisma ORM）       │
                    │  data_tables / data_fields /  │
                    │  table_records(JSON) / ...    │
                    └──────────────────────────────┘
```

模块化单体（非微服务），前后端分离，Docker Compose 一键部署。

## 3. 技术栈

**后端**：Node.js · NestJS 11 · TypeScript（strict）· Prisma ORM 6 · MySQL 8.x · JWT + Refresh Token（轮换）· class-validator / class-transformer · Swagger / OpenAPI · Helmet / CORS / 限流 · ExcelJS 流式读写 · bcryptjs

**前端**：Vue 3 · TypeScript · Vite · Composition API · Vue Router · Pinia · Axios · Element Plus · vxe-table

**部署**：Docker Compose（mysql / backend / frontend / nginx）

## 4. 环境要求

- Node.js ≥ 20
- npm ≥ 10
- MySQL 8.x（本地开发可用 Docker 或已有实例）
- Docker + Docker Compose（部署）

## 5. 目录结构

```
├── backend/                  # NestJS 后端
│   ├── prisma/               # Schema / migrations / seed
│   ├── scripts/create-admin.ts
│   ├── src/
│   │   ├── auth/             # 登录 / JWT / Refresh / 改密
│   │   ├── users/ roles/     # 用户与角色（RBAC）
│   │   ├── projects/ tables/ fields/ records/
│   │   ├── formula/          # 公式引擎（tokenizer/parser/validator/evaluator/dependency）
│   │   ├── query-engine/     # Query DSL（types/dto/validator/compiler/service）
│   │   ├── api-keys/         # API 密钥（仅存哈希）
│   │   ├── audit/            # 审计日志
│   │   ├── external/         # EXTERNAL 表元数据白名单
│   │   ├── export/ import/   # Excel 导出 / 导入
│   │   └── common/           # 守卫 / 过滤器 / 拦截器 / 装饰器
│   └── test/                 # 单元测试 + e2e（真实 MySQL）
├── frontend/                 # Vue 3 前端
│   └── src/
│       ├── api/ stores/ router/ layouts/ components/ views/ utils/ types/
├── nginx/                    # 反向代理 + 静态资源
├── docker-compose.yml
└── README.md
```

## 6. 本地开发启动

> 所有命令都必须在**项目根目录**（即包含 `backend/`、`frontend/` 的目录）下执行：
> - Windows PowerShell / CMD：先 `cd <项目根目录>`
> - Linux / macOS / Git Bash / WSL：先 `cd <项目根目录>`
>
> 也可以使用一键脚本：`start-dev.ps1`（PowerShell）或 `start-dev.sh`（bash）。

### 6.1 准备 MySQL

```bash
# 方式 A：Docker
docker run -d --name dms-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=dms_dev \
  mysql:8.4

# 方式 B：使用已有 MySQL，创建数据库即可
mysql -uroot -p -e "CREATE DATABASE dms_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 6.2 后端

```bash
cd backend
npm install
cp .env.example .env        # 修改 DATABASE_URL 等
npx prisma migrate dev      # 执行迁移
npm run db:seed             # 初始化角色 ADMIN/DEVELOPER/VIEWER
npm run create-admin        # 交互式创建管理员（账号不硬编码）
npm run start:dev           # http://localhost:3000
```

### 6.3 前端

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173（已配置 /api 代理到 3000）
```

浏览器访问 http://localhost:5173 ，用刚创建的管理员账号登录。

## 7. Docker 部署

```bash
cp .env.example .env        # 修改所有密钥
docker compose up -d --build
```

- 前端：http://localhost:8080
- Swagger：http://localhost:8080/api/docs
- 初始化管理员：`docker compose exec backend npm run create-admin`

> 如需连接已有 MySQL：修改 `docker-compose.yml` 中 backend 的 `DATABASE_URL`，
> 指向外部实例（需可被容器访问），并确保已执行过迁移：
> `docker compose exec backend npx prisma migrate deploy`

## 8. 外部 MySQL 表（EXTERNAL）

1. 管理员/开发者进入项目 → 新建数据表 → 选择「外部表」→ 从白名单选择物理表；
2. 系统读取 information_schema 自动生成字段元数据（表名/列名均来自元数据白名单，不允许拼接 SQL）；
3. 通过统一 UI 与 Query API 查询、筛选、排序、分页、精确查询；只读（写入返回 EXTERNAL_TABLE_READ_ONLY）。

## 9. REST API 与自动化脚本接入

统一前缀 `/api/v1`，认证：

- 网页用户：`Authorization: Bearer <JWT>`
- API / 脚本：`Authorization: Bearer dms_xxxxxxxx`（API 密钥在「API 密钥」页面创建，完整 Key 仅显示一次，数据库只保存哈希）

### 9.1 精确查询（EXACT，大小写敏感）

```http
GET /api/v1/tables/:tableId/records/find?field=sku&value=ABC123
```

```http
POST /api/v1/tables/:tableId/records/find-one
Content-Type: application/json
Authorization: Bearer dms_xxx

{ "field": "sku", "value": "ABC123" }
```

无记录返回 `{ "success": true, "data": { "record": null } }`；
匹配多条且非唯一字段时返回 MULTIPLE_RECORDS_FOUND（不会擅自取第一条）。

### 9.2 Query DSL（筛选/排序/分页均在 MySQL 完成）

```http
POST /api/v1/tables/:tableId/records/query
Authorization: Bearer dms_xxx

{
  "filters": [
    { "field": "sku", "operator": "eq", "value": "ABC123" },
    { "field": "shop", "operator": "eq", "value": "Amazon-US" }
  ],
  "logic": "AND",
  "sort": [{ "field": "sales", "order": "desc" }],
  "page": 1,
  "pageSize": 100
}
```

操作符白名单：`eq / neq / contains / not_contains / starts_with / ends_with / gt / gte / lt / lte / in / not_in / is_null / is_not_null`
（按字段类型限制适用操作符；NUMBER 禁止 LIKE；`eq` 严格精确匹配、大小写敏感）。

### 9.3 插入 / 更新 / 删除

```http
POST   /api/v1/tables/:tableId/records          # 新增
PATCH  /api/v1/tables/:tableId/records/:id      # 更新
DELETE /api/v1/tables/:tableId/records/:id      # 删除
```

字段一律使用 field_key（字段管理界面可见）；FORMULA 字段只读，写入返回 FORMULA_FIELD_READ_ONLY。

### 9.4 Batch 写入（事务）

```http
POST /api/v1/tables/:tableId/records/batch
{
  "records": [
    { "sku": "ABC001", "sales": 100 },
    { "sku": "ABC002", "sales": 200 }
  ]
}
```

上限由 `BATCH_INSERT_LIMIT` 控制（默认 1000）；任一条校验失败整体回滚并提示索引。

### 9.5 Upsert（match 精确匹配）

单字段匹配：

```http
POST /api/v1/tables/:tableId/records/upsert
{
  "match": { "order_id": "MB123456" },
  "data":  { "order_id": "MB123456", "sku": "ABC123", "sales": 299 }
}
```

组合字段匹配（推荐配合组合唯一约束）：

```http
POST /api/v1/tables/:tableId/records/upsert
{
  "match": { "shop": "Amazon-US", "sku": "ABC123" },
  "data":  { "sales": 299 }
}
```

匹配逻辑 EXACT（禁止 LIKE/contains）：存在则 UPDATE，不存在则 INSERT；
匹配到多条返回 MULTIPLE_RECORDS_FOUND。批量版本：`POST /records/batch-upsert`。

### 9.6 Excel 导入

```http
POST /api/v1/tables/:tableId/records/import
Content-Type: multipart/form-data
Authorization: Bearer dms_xxx
（表单字段 file = 本地 .xlsx 文件）
```

返回：`{ imported, totalRows, skippedColumns: [...], errors: [{ row, code, message }] }`
- 第一行为表头，按「字段标识 / 字段名称」匹配字段；未匹配列与公式列跳过并报告
- 单选/多选支持选项值或显示名；日期自动格式化；逐行校验，失败行不影响其余行
- 单次上限 EXCEL_IMPORT_LIMIT（默认 1000，最大 5000）；下载模板：`GET /tables/:tableId/records/import/template`

## 10. FORMULA 公式

- 支持：`+ - * / ( )`、比较 `> < >= <= == !=`、函数 `SUM AVG PRODUCT DIVIDE MAX MIN`
- 只读字段，禁止直接写入；可引用 NUMBER 字段与返回 NUMBER/BOOLEAN 的公式（形成依赖链）
- 循环引用（直接/间接）返回 FORMULA_CIRCULAR_REFERENCE；除以 0 返回 FORMULA_DIVIDE_BY_ZERO（前端显示 #DIV/0!）
- 公式定义修改后自动分批（500 条/批）重算历史记录；也可手动触发：
  `POST /api/v1/tables/:tableId/formula/recalculate`
- 前端「字段管理 → 公式字段」提供可视化编辑器（字段/函数/运算符点击插入 + 实时校验）

## 11. 测试

> 前端 UI 冒烟测试（可选）：`ui-test.cjs`（项目根目录），用本机 Edge 验证登录/排序/新建字段/新增记录/导入/分页/批量删除。
> 临时安装 Playwright 后运行：`cd frontend && npm i -D playwright && node ../ui-test.cjs`（用后 `npm prune` 移除）。

```bash
cd backend

# 单元测试（公式引擎，无需数据库）
npm run test:unit

# e2e 集成测试（真实 MySQL，自动重建 dms_test 库）
# 默认连接 mysql://root@127.0.0.1:3307/dms_test，可用 TEST_DATABASE_URL 覆盖
npm run test:e2e

# 质量检查
npm run lint
npm run typecheck
npm run build
```

e2e 覆盖：Auth/RBAC 越权、字段类型不可变、唯一字段/组合唯一约束、精确查询回归
（eq 绝不退化为 LIKE、大小写敏感、find/find-one、SQL 注入）、公式全链路、Batch/Upsert、
API 密钥、EXTERNAL 表、Excel 导入/导出、批量删除、审计日志。

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

## 12. 生产部署注意事项

1. 更换所有密钥：`.env` 中的 JWT_SECRET、JWT_REFRESH_SECRET、API_KEY_SECRET、数据库密码；
2. HTTPS：建议在 nginx 前加 TLS 终结，并将 COOKIE_SECURE=true；
3. 首个管理员：部署后立即执行 `npm run create-admin`（代码中不硬编码任何管理员账号）；
4. 大数据量（十万级）精确查询：MySQL `WHERE → LIMIT` 完成，配合 is_indexed 标记高频字段
   （为未来 Generated Column / Functional Index 预留扩展点）；
5. 定期备份 MySQL 数据卷；审计日志建议归档；
6. 如需对接已有 MySQL：仅需修改 DATABASE_URL，EXTERNAL 表按第 8 节注册即可。

## 12.1 前端依赖版本说明

`vxe-table` 与 `vxe-pc-ui` 已精确锁定为互相兼容的版本组合：
`vxe-table@4.9.7` + `vxe-pc-ui@1.9.25`。请勿盲目升级：
- `vxe-table@4.20.x` 需要 `vxe-pc-ui@4.x`（其组件注册机制已改变），
  与 `vxe-pc-ui@1.x` 组合会导致表格渲染崩溃（renderEmptyElement is not a function）；
- 如需升级，请同时升级两者并回归验证表格、排序与加载状态。

## 13. 常见问题

- 登录后接口 401：确认 COOKIE_SECURE 与访问协议匹配（HTTPS 下为 true，HTTP 下为 false）；
- 修改 .env 后不生效：后端需重启；Docker 中 `docker compose up -d --force-recreate backend`；
- 外部表中文列名：列名需为常规标识符（字母/数字/下划线）才会进入白名单。
