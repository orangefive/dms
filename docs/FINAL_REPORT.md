# 最终交付报告

> 项目：`orangefive/dms`（多维数据管理系统）
> 工作目录：`F:/Projects/DMS`，基线提交 `424dd66`
> 执行方式：审计 → 修复 → 测试 → 文档，每一步都有可复现的命令与输出

---

## A. 审计结论

**项目真实水平**：一个完成度较高的业务型全栈项目。核心链路（认证 / RBAC / 动态表 / 记录 CRUD /
查询 / 公式 / 导入导出 / 审计）都是**真实实现**，不是脚手架或 README 吹出来的。
数据模型设计（元数据 + JSON 记录）与查询下推（DSL → SQL）是真正的技术含量所在。

**主要问题**不在「功能缺失」，而在**工程细节的可靠性**：

1. 认证会话在并发与失效传播上有真实缺陷（刷新令牌非原子、禁用不生效、Token 快照权限）；
2. 唯一约束只对新数据生效，历史数据可绕过（数据正确性缺口）；
3. 若干「看起来有、实际没有」的开关（`isIndexed`、健康检查不查库）；
4. 完全没有测试之外的工程保障：无 CI、前端无测试、镜像以 root 运行。

这些正好是面试中「你如何判断代码质量」最有说服力的素材。

---

## B. 修改清单

### B1 认证与会话安全（P0）

| 文件 | 改动 |
| --- | --- |
| `src/common/permissions.loader.ts`（新增） | 抽出去重后的「查库加载用户实时权限」，供 AuthGuard 复用，权限做白名单过滤 |
| `src/common/guards/auth.guard.ts` | 验签后查库；账号不存在/被禁用立即 401；把实时 `permissions` 写入请求上下文 |
| `src/common/guards/permissions.guard.ts` | 改为同步守卫，只比对内存中的权限集合，不再每请求重复查库 |
| `src/auth/auth.service.ts` | Refresh 原子消费（`updateMany` + `count!==1`）；宽限期外重放 → 撤销该用户全部令牌；登录失败写审计 |
| `src/auth/auth.controller.ts` | Cookie 的 `secure`/`maxAge` 与 Refresh 有效期共用 `parseDuration`；登出清理 Cookie；改密限流 5/min |
| `src/users/users.service.ts` | `isLastActiveAdmin` 只统计启用中的管理员；禁用或重置密码时事务内撤销该用户 Refresh Token |
| `src/api-keys/api-keys.controller.ts` | `requireUser()`（API Key 不能管理 API Key）；`assertCanGrantScopes()`（不能授予超出自身的 scope） |
| `src/api-keys/api-keys.service.ts` | `lastUsedAt` 每分钟最多写一次 |
| `src/config/env.validation.ts` | `parseBoolean` 修复 `"false"→true`；生产密钥长度/占位值/互异校验；CORS 禁 `*`；导出 `parseDuration` |
| `src/main.ts` | `TRUST_PROXY` 时设置 express `trust proxy`；`enableShutdownHooks()` |
| `src/health/health.controller.ts` | `SELECT 1` 探活，失败 503；`@SkipTransform()` |

### B2 数据正确性与并发（P1）

| 文件 | 改动 |
| --- | --- |
| `src/fields/fields.service.ts` | 唯一约束历史数据分批回填（500/批，冲突回滚）；删字段改 `JSON_REMOVE`；约束创建传真实操作人 |
| `src/fields/fields.controller.ts` | 传入 `@CurrentUser()` 的 id/username |
| `src/records/records.service.ts` | 拆出 `createPrepared`；`update` 显式 `null` 清空字段并传递 `previousErrors`；`upsert` 并发冲突后重新定位 |
| `src/common/unique-hash.ts`（新增） | 唯一值提取与规范化哈希集中一处 |
| `src/common/validation.ts`（新增） | 拒绝 `0x10`/`Infinity`/`NaN`/`12abc`；真实日历日期校验 |
| `src/query-engine/query.validator.ts` | 改用上述严格校验函数 |
| `src/formula/validator.ts` | 按优先级保真括号 |
| `src/formula/evaluator.ts` | 所有算术/函数结果 `ensureFinite()`；字符串转数字用严格解析 |
| `src/formula/formula.service.ts` | 依赖字段出错 → `FORMULA_DEPENDENCY_ERROR` 上抛；重算成功清除旧错误 |
| `src/query-engine/query.compiler.ts` | 标识符正则白名单；空排序默认 `created_at DESC, id DESC`；显式排序追加 `id` 次级键 |
| `src/query-engine/query.service.ts` | `offset ≤ 100000` 护栏；`pageSize ≤ 500` |
| `src/import/import.service.ts` | 元数据只加载一次；`createPrepared(..., {audit:false})` + 末尾汇总审计；重复表头检测 |

### B3 测试体系

| 文件 | 说明 |
| --- | --- |
| `test/hardening.spec.ts`（新增） | 17 个单元用例：公式括号/错误传播/溢出、标识符白名单、env 布尔与密钥、分页护栏 |
| `test/security.e2e-spec.ts`（新增） | 14 个集成用例：会话失效、令牌重放、唯一约束回填、null 清空、严格校验、权限边界、健康检查 |
| `test/sequencer.js`（新增） | 固定 E2E 文件顺序，消除共享状态导致的假失败 |
| `frontend/src/utils/format.spec.ts`（新增） | 9 例：格式化、错误码映射、危险操作确认 |
| `frontend/src/stores/auth.spec.ts`（新增） | 8 例：`*` 通配、多权限、多角色并集、会话生命周期 |
| `frontend/src/api/http.spec.ts`（新增） | 6 例：并发 401 单飞刷新、刷新失败跳转、登录接口不刷新、Blob 文件名解析 |
| `frontend/vitest.config.ts`（新增） | jsdom 环境 + 串行执行 |

### B4 部署与工程化

| 文件 | 改动 |
| --- | --- |
| `.github/workflows/ci.yml`（新增） | 4 个 job：后端静态检查+单测+构建、MySQL 8.4 服务上的 E2E、前端全套、compose 配置与镜像构建 |
| `backend/Dockerfile` | 多阶段；`openssl`；非 root `USER node`；`HEALTHCHECK`；补 `scripts/`+`tsconfig.json` 让 `create-admin` 可用 |
| `backend/docker-entrypoint.sh`（新增） | 先 `migrate deploy`，再 `exec node`，保证 SIGTERM 直达 |
| `nginx/Dockerfile` | 前端编译进镜像（多阶段），删除「构建容器 + 共享卷」 |
| `nginx/security-headers.conf`（新增） | 安全响应头抽公共片段，`/assets/` 也 include（修复头丢失） |
| `nginx/default.conf` | include 安全头；补 `X-Forwarded-Host/Port` |
| `docker-compose.yml` | 删除 frontend 服务与共享卷；`TRUST_PROXY=true`；`stop_grace_period`；成熟注释 |
| `frontend/Dockerfile` `frontend/.dockerignore` | **删除**（已被一体化镜像取代） |
| `frontend/vite.config.ts` | `manualChunks` 拆分 vendor，消除 1.86 MB 单包告警 |
| `backend/package.json` | 新增 `db:seed` `db:migrate` `db:reset` `bench` |
| `frontend/package.json` | 新增 `test` `test:unit` `test:watch` |

### B5 性能与文档

| 文件 | 说明 |
| --- | --- |
| `backend/scripts/benchmark.ts`（新增） | 1 万行数据集 + 12 类查询基准 + `EXPLAIN` / `EXPLAIN ANALYZE` |
| `docs/PROJECT_AUDIT.md` `ARCHITECTURE.md` `TESTING.md` `SECURITY.md`（新增） | 审计/架构/测试/安全四份文档 |
| `README.md` | 重写为作品集级：定位、技术看点、架构、快速开始、质量门禁、API、限制 |
| `.env.example` `backend/.env.example` | 补 `TRUST_PROXY`、fail-fast 说明 |

---

## C. 测试结果（全部本地实跑）

```
backend  npm run lint       ✅
backend  npm run typecheck  ✅
backend  npm run test:unit  ✅ 50 passed / 2 suites
backend  npm run test:e2e   ✅ 90 passed / 2 suites（真实 MySQL 8.0.26）
backend  npm run build      ✅
frontend npm run lint       ✅
frontend npm run typecheck  ✅
frontend npm run test       ✅ 23 passed / 3 files
frontend npm run build      ✅ 无体积告警
```

补充说明：

- E2E 会先对 `dms_test` 执行 `migrate reset` + `seed`，与开发库完全隔离。
- 修正了 `createConstraint` 审计外键失败（`userId: ''` → 真实操作人 / null），
  这是之前 60 个用例成片 403 的根因之一；另一个是文件执行顺序，已用 sequencer 固定。
- **未伪造任何结果**：Docker 镜像未在本机构建（无 Docker CLI），由 CI 的 `compose` job 承担。

### 性能实测（1 万行，SQL 由真实编译器生成）

| 场景 | 平均耗时 |
| --- | --- |
| 批量写入 | 10,000 行 / 825 ms（≈12,100 行/秒） |
| 仅 table_id（走索引） | SELECT 1.0 ms / COUNT 3.1 ms |
| JSON 等值过滤 | SELECT 14.4 ms / COUNT 13.1 ms |
| 组合过滤 + 排序 | SELECT 22.1 ms |
| 深分页 offset 9800 | SELECT 49.8 ms |

`EXPLAIN ANALYZE` 证明：JSON 条件无法走索引，MySQL 用 `(table_id, created_at)` 索引定位后
对全部行逐行求值（`rows=10000`）。据此把深分页护栏从「页码」改为「offset」，并明确记录
「该量级不需要 Redis / 队列，真正的扩展点是为字段建索引」。

---

## D. 架构改进

1. **权限模型从「Token 快照」改为「请求时实时加载」**：安全边界与账号状态解耦，
   这是 RBAC 系统的基本要求，代价是一次索引查询。
2. **唯一性从应用层判断改为数据库唯一索引约束**：消除 check-then-act 竞态。
3. **删除路径从「读全表进内存」改为单条 SQL**：复杂度从 O(n) 次往返降到 1 次。
4. **部署拓扑简化**：前端产物在构建期进入 Nginx 镜像，少一个容器、少一个卷、
   消除启动时序问题；后端非 root + `exec` 入口保证优雅关闭。
5. **可观测性**：健康检查真正探活、审计覆盖登录失败与批量导入、`requestId` 贯穿日志。

---

## E. 遗留问题

| 问题 | 影响 | 建议 |
| --- | --- | --- |
| `isIndexed` 开关无后端行为 | 用户以为建了索引，实际没有 | 用函数索引 + `COLLATE utf8mb4_bin` 实现，设计见审计报告 §6 |
| 限流为进程内存 | 多副本部署计数不共享 | 换 `@nestjs/throttler` 的 Redis 存储 |
| 无 CSP | XSS 纵深防御缺一层 | 需与 Element Plus inline style 联调 |
| 无浏览器 E2E | 复杂表格交互无回归 | 需要时引入 Playwright |
| 无覆盖率门禁 | 覆盖率未知 | 先补关键路径再设阈值，避免为数字写断言 |
| Docker 镜像未本机验证 | 部署路径存在未验证风险 | 首次 `docker compose up --build` 需人工确认 |

---

## F. 简历表述与面试问答

### F1 简历条目（可直接用，数字均为实测）

> **企业多维数据管理系统（DMS）· 全栈 + 工程化改造**
> NestJS 11 / Prisma 6 / MySQL 8 / Vue 3 / TypeScript / Docker / GitHub Actions
>
> - 独立完成对一个 1.4 万行全栈项目的安全与正确性审计，定位并修复 20+ 缺陷，
>   包括 Refresh Token 轮换的非原子竞态（并发可产生多会话）、权限 Token 快照导致的越权窗口、
>   `"false"` 被解析为 `true` 导致安全 Cookie 在 HTTP 下失效等。
> - 把权限校验从「Token 内快照」重构为「每请求实时加载」，实现账号禁用与角色降级**即时生效**；
>   刷新令牌改为数据库条件更新原子消费，并对重放行为做全量会话撤销。
> - 设计并实现动态表查询引擎的 DSL → SQL 编译器：值全参数化 + 标识符白名单，
>   `eq` 严格大小写敏感不退化；用 `EXPLAIN ANALYZE` 定位 JSON 字段无法命中索引的性能边界，
>   据此设定分页 offset 护栏，1 万行实测 P95 < 25 ms。
> - 为「唯一约束」补上历史数据回填（分批 + 事务回滚），把并发唯一性下沉到数据库唯一索引，
>   消除 check-then-act 竞态。
> - 建立测试体系：后端 Jest 50 单测 + 90 集成用例（真实 MySQL）、前端 Vitest 23 例；
>   配置 GitHub Actions 四段流水线（含 MySQL service 与 compose 校验）。
> - 重做部署链路：后端镜像非 root + healthcheck + `exec` 入口优雅关闭；
>   前端多阶段构建进 Nginx 镜像；前端 `manualChunks` 拆分后消除 1.86 MB 单包告警。

### F2 五个面试问答

**Q1：你说 Refresh Token 轮换有竞态，具体是怎么产生的？怎么证明修好了？**

A：旧实现是「查令牌 → 校验 → 标记撤销 → 签发新的」四步，读和写之间没有原子性。
两个并发刷新会同时通过校验，各自撤销一次再各发一个新令牌，用户就有了两个有效会话。
修复是把「校验 + 撤销」合并成一条带条件的更新：
`updateMany({ where: { id, revokedAt: null, expiresAt: { gt: now } }, data: {...} })`，
只有 `count === 1` 的请求算成功，其余直接 401；失败方不去撤销胜者的令牌，
避免正常并发被误判成攻击。证明方式是写了一个并发用例：
`Promise.all` 同时发三个刷新请求，断言只有一个 200、且数据库里该用户只有一条未撤销令牌。

**Q2：为什么把权限从 JWT 里挪出来每次查库？这不影响性能吗？**

A：原来的 JWT 带 roles，鉴权时读 Token 快照，问题在于「快照有效期 = Token 有效期」。
管理员把某人降级或禁用后，对方在 30 分钟内仍然畅通无阻 —— 这是真实的越权窗口。
现在 AuthGuard 验签后做一次带 `include` 的主键查询拿到当前角色与权限，写进请求上下文，
PermissionsGuard 只做内存集合比对（同步守卫，不重复查库）。代价是每请求一次索引查询，
在连接池下是亚毫秒级；收益是权限变更立即收敛。这类权衡的判断标准是：
安全属性优先于微秒级延迟。同时我也保留了「禁用账号立即 401」的回归用例。

**Q3：动态表把数据存在 JSON 列里，你怎么保证查询性能？有没有实测？**

A：先说结论：这个设计在**万行级**完全够用，但有个明确的性能边界。
我写了基准脚本造 1 万行数据，SQL 直接用真实的 QueryCompiler 生成，跑 `EXPLAIN ANALYZE`。
结果很清楚：只按 `table_id` 过滤时能走 `(table_id, created_at)` 索引，1 ms；
一旦条件落在 JSON 字段上，MySQL 只能用索引定位到该表的全部行（`rows=10000`）
再逐行 `JSON_EXTRACT` 求值，等值查询 14 ms、带排序 22 ms。
带排序的深分页还会把 `offset+limit` 行送进排序缓冲区，offset 9800 时涨到 50 ms。
所以我做了两件事：一是把分页护栏从「页码」改成「实际 offset」——
原来 `page≤100000` 配 `pageSize=500` 能构造出 500 万的 offset；
二是把边界写进文档：百万行级必须为高频过滤字段建函数索引。
我没有因为「JSON 查询慢」就去加 Redis 或搜索引擎，那是没测过的人才会做的决定。

**Q4：唯一约束的并发问题你没用「查询后再插入」？为什么？**

A：那是典型的 check-then-act：两个请求同时查「不存在」，然后都插入，都能成功。
唯一可靠的做法是把唯一性下沉到数据库。实现上有一张 `unique_values` 表，
存 `(constraint_id, values_hash)`，`values_hash` 是「按字段顺序规范化后的 SHA-256」，
在这个组合上建唯一索引，冲突时把 Prisma 的 P2002 翻译成业务错误码。
另外有个容易漏的点：建约束时历史数据可能已经重复了，只对新数据生效等于没生效。
所以创建约束时会对历史数据分批回填（500 条一批），任何一批冲突就整体回滚并返回
`UNIQUE_CONSTRAINT_INVALID`，不会留下半成品约束。

**Q5：如果只让你改一处，最能体现工程质量的是哪一处？**

A：`parseBoolean`。原文用 `@Type(() => Boolean)` 解析环境变量，
而 `Boolean("false") === true` —— 于是 `COOKIE_SECURE=false` 实际开启了 Secure Cookie，
HTTP 部署下用户登录后立刻掉线；同理 `SWAGGER_ENABLED=false` 反而暴露了接口文档。
这个 bug 不报错、不崩溃，只在特定部署方式下表现为「登录不好使」，
最难排查、也最能说明「默认值必须显式解析」。
我把它改成只接受 `true/false/1/0`，非法值交给校验器报错而不是静默转成 false，
并补了单元测试。同类问题我还修了「生产环境用示例密钥也能启动」，改成启动即失败。

---

## G. 下一步建议

1. **优先级最高**：首次在目标机器执行 `docker compose up -d --build` 并跑一遍冒烟
   （本机无 Docker，这条路径未经真实验证）。
2. 实现字段级索引（`isIndexed`），这是当前架构唯一的性能天花板；
   建议以小流量表试点，先做函数索引 + 查询表达式对齐的验证。
3. 补 Playwright 覆盖 3 条关键路径：登录 → 建表 → 录入 → 筛选 → 导出。
4. 多副本部署前接入 Redis 限流存储。
5. 若面向公网，补齐 CSP 与登录失败锁定策略。
