# DMS 项目审计报告

> 审计对象：`orangefive/dms`（提交 `424dd66`，分支 `main`）
> 审计方式：通读源码 + 追踪调用链 + 在独立测试库（`dms_test`）上执行真实测试与基准
> 说明：本文所有结论都来自代码与实测输出，不引用 README 的功能宣称；无法执行的部分（Docker 镜像构建）在文中显式标注。

---

## 1. 技术栈与运行形态

| 层 | 技术 | 版本 |
| --- | --- | --- |
| 后端 | NestJS + TypeScript | 11.x / 5.7 |
| ORM | Prisma | 6.19.3 |
| 数据库 | MySQL | 8.0.26（本地）/ 8.4（Compose） |
| 前端 | Vue 3 + Vite + Element Plus + vxe-table | 3.5 / 6.x / 2.9 / 4.9 |
| 部署 | Docker Compose + Nginx | — |

模块化单体：`auth` `users` `roles` `api-keys` `projects` `tables` `fields` `records`
`query-engine` `formula` `import` `export` `external` `audit` `health` `prisma` `config` `common`。
共 14 个 Controller，9 个前端页面。

数据模型的核心设计是**动态表**：

- `SYSTEM` 表：字段定义存在 `data_fields`，记录存在 `table_records.data`（JSON 列），
  由 `QueryCompiler` 把查询 DSL 编译成 `JSON_EXTRACT` 系列 SQL。
- `EXTERNAL` 表：映射已有物理表，只读，通过 `information_schema` 做列白名单。

---

## 2. 功能完成度（逐模块）

状态定义：**已验证** = 有代码 + 有自动化测试覆盖；**部分** = 主路径可用但存在明确缺口；
**声明未实现** = 元数据/UI 存在但后端无对应行为。

| 模块 | 状态 | 证据 |
| --- | --- | --- |
| 登录 / 刷新 / 登出 / 改密 | 已验证 | E2E `Auth / RBAC`，含并发刷新、令牌重放 |
| RBAC 后端强制 | 已验证 | 每次请求从 DB 加载权限；E2E 角色降级即时收敛 |
| 用户 / 角色管理 | 已验证 | E2E；禁用与重置密码会撤销会话 |
| API Key | 已验证 | E2E `API Key`，含 scope 越权与「API Key 不能管理 API Key」 |
| 审计日志 | 已验证 | E2E `审计日志`，覆盖登录失败与批量导入汇总 |
| 项目 / 表 / 字段管理 | 已验证 | E2E `字段管理` |
| 记录 CRUD / 批量 / upsert | 已验证 | E2E `记录 CRUD 与校验` |
| Query DSL（过滤/排序/分页） | 已验证 | 单测 + E2E `精确查询核心回归` + EXPLAIN 基准 |
| 唯一约束（单字段 / 组合） | 已验证 | E2E 回填成功/失败回滚 |
| 公式引擎 | 已验证 | 单测（括号保真、依赖传播）+ E2E `公式全链路` |
| Excel 导入 / 导出 | 已验证 | E2E `Excel 导入` / `Excel 导出` |
| EXTERNAL 物理表只读查询 | 部分 | E2E `EXTERNAL 表` 覆盖主路径；未做大表与跨库验证 |
| 字段 `isIndexed` 开关 | **声明未实现** | 见 §4 P2-1：仅落库 + UI 展示，查询编译器完全忽略它 |
| 前端权限控制 | 部分 | 路由守卫 + `can()` 隐藏入口；真正的强制在后端（正确做法） |
| 前端自动化测试 | 新增 | Vitest 23 例（工具函数、权限判定、401 单飞刷新） |

---

## 3. 调用链核查（抽样）

以「表格过滤查询」为例，实际链路：

```
TableView.vue → api/records.query()
  → POST /api/v1/tables/:id/records/query
    → ThrottlerGuard → AuthGuard（验签 + 查库加载实时权限）→ PermissionsGuard（内存比对）
    → ValidationPipe（QueryDto / 嵌套 filters 校验）
    → QueryService.query()
        → loadTable / loadFields（各一次 DB 查询）
        → validateFilter / validateSort（字段存在性 + 操作符白名单 + 值类型）
        → QueryCompiler.compileWhere / compileOrderBy（标识符白名单 + 全参数化）
        → prisma.$queryRaw（COUNT + SELECT 两条 SQL）
```

审计中确认的两个事实（与 README 宣称不同）：

1. **`eq` 确实是精确匹配**：编译为 `CAST(... AS CHAR CHARSET binary) = ?`，大小写敏感，不会退化为 `LIKE`。
2. **`pageSize` 上限是 500**（不是 README 早期写的 300），且页码/偏移有硬上限。

---

## 4. 问题清单

### P0（安全 / 可导致越权或数据损坏）

| # | 问题 | 影响 | 处理 |
| --- | --- | --- | --- |
| P0-1 | `@Type(() => Boolean)` 把字符串 `"false"` 解析为 `true` | `COOKIE_SECURE=false` 实际开启安全 Cookie，HTTP 部署下登录态直接失效；`SWAGGER_ENABLED=false` 反而暴露文档 | 已修复：新增 `parseBoolean`，只接受 `true/false/1/0` |
| P0-2 | JWT 内携带 roles，`PermissionsGuard` 依赖 token 快照 | 管理员降级/禁用后，旧 Access Token 在有效期内仍可越权 | 已修复：改由 `AuthGuard` 每次请求查库加载实时权限 |
| P0-3 | 禁用账号只影响下次登录 | 已签发的 Access Token 最长 30 分钟内仍可用 | 已修复：`isActive=false` 立即 401 |
| P0-4 | Refresh Token 轮换非原子（先查后改） | 并发刷新可产生多个有效会话 | 已修复：`updateMany({ id, revokedAt: null, expiresAt: { gt: now } })` 原子消费，`count !== 1` 即拒绝 |
| P0-5 | 已撤销令牌被重放时无处置 | 令牌泄露后无法止损 | 已修复：超过 30s 宽限期的重放 → 撤销该用户全部 Refresh Token |
| P0-6 | 生产环境缺少密钥强度校验 | 用示例占位密钥直接上生产 | 已修复：长度 ≥32、占位值检测、三密钥互不相同、CORS 禁止 `*`，不满足即启动失败 |
| P0-7 | 动态标识符只依赖参数绑定 | 元数据被污染时可注入 SQL 片段 | 已修复：标识符正则白名单二次校验 |

### P1（业务逻辑 / 并发 / 数据正确性）

| # | 问题 | 影响 | 处理 |
| --- | --- | --- | --- |
| P1-1 | 创建唯一约束不回填历史数据 | 历史重复数据绕过约束 | 已修复：分批（500/批）回填 `unique_values`，冲突则整事务回滚并返回 `UNIQUE_CONSTRAINT_INVALID` |
| P1-2 | `isLastActiveAdmin` 统计包含已禁用管理员 | 可能把系统锁死到无可用管理员 | 已修复：仅统计 `isActive: true` |
| P1-3 | 删除字段把全表记录读进内存逐条 UPDATE | 大表下 OOM / 长时间锁 | 已修复：改为单条 `JSON_REMOVE ... WHERE JSON_CONTAINS_PATH` |
| P1-4 | 公式规范化丢括号 | `(a+b)*c` 被改写为 `a + b * c`，语义错误 | 已修复：按优先级保真括号 |
| P1-5 | 上游公式错误被当作 0 参与计算 | 错误静默传播 | 已修复：新增 `FORMULA_DEPENDENCY_ERROR` 并向上传播，重算成功后清除旧错误 |
| P1-6 | `Infinity` / `0x10` / `2026-02-31` 通过校验 | 写入 JSON 变 null 或得到意外数值 | 已修复：`isNumericInput` 只接受十进制有限数；日期做真实日历校验 |
| P1-7 | 空排序时 `ORDER BY` 不稳定 | 翻页出现重复/漏行 | 已修复：默认 `created_at DESC, id DESC`，显式排序追加 `id ASC` 作为次级键 |
| P1-8 | API Key 可授予超出自身的 scope、可用 API Key 管理 API Key | 权限提升 | 已修复：`assertCanGrantScopes` + `requireUser` |
| P1-9 | `createConstraint` 审计写入 `userId: ''` | 外键约束失败，接口 500 | 已修复：传真实操作人；允许匿名时写 `null` |
| P1-10 | Excel 导入逐行重复查询元数据 | 导入 1 万行放大成 1 万次元数据查询 | 已修复：元数据只加载一次，逐行走 `createPrepared`，末尾写一条汇总审计 |
| P1-11 | 导入不检测重复表头 | 后出现的列静默覆盖前一个 | 已修复：返回 `duplicateColumns` |
| P1-12 | 深分页只限制页码 | `pageSize=500` 时 offset 可达数千万 | 已修复：以 `offset ≤ 100000` 为护栏（依据见 §5） |

### P2（健壮性 / 声明与实现不符）

| # | 问题 | 处理 |
| --- | --- | --- |
| P2-1 | `data_fields.is_indexed` 与前端开关无任何后端行为：编译器不使用它，也不创建索引 | **未修复**，见 §6 |
| P2-2 | 健康检查不访问数据库，DB 挂了仍返回 200 | 已修复：`SELECT 1`，失败返回 503，且跳过统一响应包装 |
| P2-3 | `lastUsedAt` 每次 API Key 调用都写库 | 已修复：每分钟最多写一次 |
| P2-4 | 进程未注册关闭钩子 | 已修复：`app.enableShutdownHooks()` + 容器入口 `exec node` |

### P3（工程化）

| # | 问题 | 处理 |
| --- | --- | --- |
| P3-1 | 无 CI | 已补 GitHub Actions（见 `docs/TESTING.md`） |
| P3-2 | 前端无测试 | 已补 Vitest 23 例 |
| P3-3 | 前端构建靠「构建容器 + 共享卷」 | 已改为多阶段构建，产物直接进 Nginx 镜像 |
| P3-4 | 后端镜像以 root 运行、无 healthcheck、`npm` 包装脚本导致信号不直达 | 已修复：非 root + healthcheck + `exec` 入口 |
| P3-5 | `nginx` 的 `/assets/` 因 `add_header` 覆盖而丢失安全头 | 已修复：抽出 `security-headers.conf` 在两处 include |
| P3-6 | README 提到不存在的 `db:seed` | 已补齐脚本别名与文档 |
| P3-7 | 前端单 chunk 1.86 MB，触发构建体积告警 | 已修复：`manualChunks` 拆分，见 §7 |

---

## 5. 性能基准（真实数据）

环境：本机 MySQL 8.0.26，单表 10,000 行，数据列全部为 JSON；
SQL 由真实 `QueryCompiler` 生成，与线上路径一致；每项预热 1 次、采样 5 次。

批量写入：**10,000 行 / 825 ms ≈ 12,100 行/秒**（每批 500 行 `createMany`）。

| 场景 | 命中行数 | COUNT 平均 | SELECT 平均 |
| --- | --- | --- | --- |
| 基线：仅 `table_id`（走索引） | 10000 | 3.1 ms | 1.0 ms |
| 等值 `sku = SKU-000500` | 1 | 13.1 ms | 14.4 ms |
| 模糊 `contains name ~ 商品-42` | 220 | 13.8 ms | 4.1 ms |
| 数值区间 `amount >= 1000` | 2700 | 16.5 ms | 1.0 ms |
| 组合过滤 + 排序（第 1 页） | 1270 | 14.7 ms | 22.1 ms |
| 组合过滤 + 排序（第 10 页） | 1270 | 14.5 ms | 22.4 ms |
| 深分页（全表 1 万行，offset 9800） | 10000 | 3.3 ms | 49.8 ms |

`EXPLAIN ANALYZE` 关键结论（原文摘录）：

```
[1] 基线：Index lookup ... (actual time=0.021..0.204 rows=50)
[2] 等值过滤：Index lookup ... (actual time=0.017..11.530 rows=10000)
    -> Filter: cast(json_unquote(json_extract(data,'$.sku')) ...) (actual rows=1)
[3] 组合排序：-> Sort: ... DESC, limit input to 50 row(s) per chunk
    -> Index lookup ... (actual time=0.015..11.146 rows=10000)
[4] 深分页：-> Limit/Offset: 50/9800 (actual time=47.885..47.890 rows=50)
    -> Sort: ... limit input to 9850 row(s) per chunk
```

解读：

1. `table_id` 有索引，**只有「不带 JSON 条件 + 默认排序」的查询能真正走索引**（1 ms）。
2. 一旦过滤/排序落在 JSON 字段上，MySQL 只能用索引定位到该表的全部行，再逐行
   `JSON_EXTRACT` 过滤（`rows=10000`），代价 O(该表行数)。在当前 1 万行量级下 14–22 ms，可接受。
3. 带排序的深分页需要把 `offset+limit` 行送进排序缓冲区（`limit input to 9850`），
   耗时随 offset 线性增长（49.8 ms）。这正是 P1-12 用 offset 而非页码设护栏的原因。

**结论（明确不做的事）**：在该量级下无需引入 Redis / 队列 / 读写分离；
真正的扩展点是「按字段建索引」，属于下一阶段工作（见 §6）。

---

## 6. 明确未做与原因

### P2-1 字段级索引（`isIndexed`）未实现

- 现状：`data_fields.is_indexed` 会落库、前端有开关、列表有图标，但
  `QueryCompiler` 从不读取它，也没有任何 DDL 为其建索引 —— 开关点了没有任何效果。
- 为什么不顺手补：JSON 值上的索引必须用函数索引或生成列，
  表达式必须与查询里的表达式**逐字一致**才会命中；而当前 `eq` 编译为
  `CAST(... AS CHAR CHARSET binary)`（大小写敏感），索引需显式 `COLLATE utf8mb4_bin`
  才能保持语义一致。这涉及运行时 DDL、字段更新时的索引迁移、已有数据回填与锁表风险，
  属于「需要独立设计与回归」的改动，不适合在本次审计中仓促合入。
- 建议实现路径：`isIndexed=true` 时对该字段建函数索引
  `((CAST(JSON_UNQUOTE(JSON_EXTRACT(data,'$.k')) AS CHAR(191)) COLLATE utf8mb4_bin))`，
  同时把编译器对该字段的表达式固定为同一字符串；迁移脚本按 `data_fields` 回放。

### 其他未覆盖项

- 未做 Docker 镜像构建验证：本机无 Docker CLI，仅通过 CI 的 `compose` job 承担。
- 未做浏览器 E2E（Playwright）：前端交互回归成本高，本次以 Vitest 覆盖纯逻辑层。
- 未做多实例部署下的限流一致性：当前 `@nestjs/throttler` 为进程内存实现，
  多副本需换 Redis 存储 —— 单实例部署下不构成问题，故未改。

---

## 7. 验收基线

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 后端 lint | `npm run lint` | 通过 |
| 后端类型检查 | `npm run typecheck` | 通过 |
| 后端单元测试 | `npm run test:unit` | 50 通过 |
| 后端集成测试 | `npm run test:e2e` | 90 通过（真实 MySQL） |
| 前端 lint | `npm run lint` | 通过 |
| 前端类型检查 | `npm run typecheck` | 通过 |
| 前端单元测试 | `npm run test` | 23 通过 |
| 前端构建 | `npm run build` | 通过（已分包，无体积告警） |

---

## 8. 前端构建产物

原始版本把所有依赖打成一个 `index-*.js`（1,863 kB），触发 Vite 体积告警。
按「低频变动的大依赖」拆分后：

| 产物 | 体积 |
| --- | --- |
| `element-plus-*.js` | 925 kB |
| `vxe-table-*.js` | 706 kB |
| `vue-vendor-*.js`（vue / vue-router / pinia） | 110 kB |
| `index-*.js`（业务入口） | 68 kB |
| 各页面 chunk | 6–44 kB |

收益：业务代码发版不再让浏览器重新下载 1.6 MB 的 UI 库；告警消除。
（CSS 仍是单文件 713 kB，源于 Element Plus 全量引入，属于可接受范围。）
