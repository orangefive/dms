# 架构说明

## 1. 总体结构

```
┌─────────────────────────────┐
│  Vue 3 SPA (Vite)           │
│  Pinia + Element Plus       │
│  axios 拦截器：解包/401 单飞 │
└──────────────┬──────────────┘
               │ /api/v1 (JSON)   /api/docs (Swagger)
┌──────────────▼──────────────┐
│  Nginx                      │  静态资源 + 反向代理
└──────────────┬──────────────┘
┌──────────────▼──────────────────────────────────────────────┐
│  NestJS（模块化单体）                                        │
│                                                             │
│  ThrottlerGuard → AuthGuard → PermissionsGuard              │
│        （限流）    （验签+查库）  （内存比对实时权限）         │
│                                                             │
│  Controller → Service → Prisma / $queryRaw                  │
│                                                             │
│  query-engine   formula   import/export   external          │
└──────────────┬──────────────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │  MySQL 8    │
        └─────────────┘
```

依赖方向严格单向：`Controller → Service → Prisma`。跨模块协作走 Service 注入
（例如 `ImportService → RecordsService`、`RecordsService → FormulaService / AuditService`），
不允许 Controller 之间互相调用。

---

## 2. 请求生命周期

1. **`RequestContextMiddleware`**：生成/透传 `requestId`，写入响应头便于排查。
2. **`ThrottlerGuard`**：全局限流；登录、改密等敏感接口额外收紧。
3. **`AuthGuard`**：校验 Bearer Token（或 API Key），**然后查库**加载用户当前角色与权限。
   - 账号不存在 / 被禁用 → 立即 401，不等 Token 自然过期。
   - 结果写入 `request.auth = { kind, user: { id, roles, permissions }, scopes }`。
4. **`PermissionsGuard`**：读取 `@RequirePermissions()` 元数据，与 `auth.permissions` 做集合比对。
   `*` 视为全权限。守卫是**同步**的，不重复查库。
5. **`ValidationPipe`**：`whitelist + forbidNonWhitelisted`，未声明字段直接 400。
6. **Controller / Service**：业务逻辑。
7. **`TransformInterceptor`**：包装为 `{ success: true, data }`；`@SkipTransform()` 可跳过（如健康检查、文件流）。
8. **`AllExceptionsFilter`**：统一为 `{ success: false, error: { code, message, details? } }`。

> 设计取舍：权限每次请求查库（一次带 `include` 的查询），换取「改权限立即生效」。
> 在单机 + 连接池下这是一次主键/索引查询，成本远低于越权风险。

---

## 3. 动态表数据模型

```
Project 1─n DataTable 1─n DataField      （字段定义：类型、唯一、公式、排序）
                     1─n TableRecord    （记录：data JSON 列）
                     1─n UniqueConstraint 1─n UniqueValue （(constraint_id, values_hash) 唯一索引）
```

- **SYSTEM 表**：字段定义在 `data_fields`，值存在 `table_records.data`（JSON）。
  新增字段无需 DDL，这是「多维表格」体验的基础。
- **EXTERNAL 表**：`external_table_name` 指向已存在的物理表，只读。
  列名先经 `information_schema` 校验，再进入编译器的标识符白名单。

代价是「JSON 无法直接建普通索引」，性能特征见 `docs/PROJECT_AUDIT.md` §5。

---

## 4. Query DSL 编译

输入（前端构造，服务端校验）：

```json
{ "filters": [{ "field": "status", "operator": "eq", "value": "已付款" }],
  "sort": [{ "field": "amount", "order": "desc" }],
  "page": 1, "pageSize": 50 }
```

编译阶段（`QueryCompiler`）：

| DSL | SYSTEM 表编译结果 |
| --- | --- |
| `eq` | `CAST(JSON_UNQUOTE(JSON_EXTRACT(data,'$.k')) AS CHAR CHARSET binary) = ?` |
| `contains` | `JSON_UNQUOTE(...) LIKE CONCAT('%', ?, '%')` |
| `in` | `JSON_UNQUOTE(...) IN (?, ?, ...)` |
| `gte/lte` | `CAST(JSON_UNQUOTE(...) AS DECIMAL(65,10)) >= ?` |
| 多值字段 | `FIND_IN_SET(?, JSON_UNQUOTE(...))` / `JSON_CONTAINS` |
| 空排序 | `ORDER BY created_at DESC, id DESC` |
| 显式排序 | `ORDER BY <expr> <dir>, id ASC`（次级键保证翻页稳定） |

安全约束：

- **所有值都是参数**（`Prisma.sql` 占位符），不存在字符串拼接值。
- **标识符**（表名、字段名）只能来自元数据，且再经 `/^[A-Za-z_][A-Za-z0-9_]*$/` 校验。
- NUMBER 类型不允许 `LIKE`；未知操作符直接拒绝。
- `page ≤ 100000`、`pageSize ≤ 500`、`offset ≤ 100000`。

分页固定两条 SQL：`COUNT(*)` 拿总数，再 `LIMIT/OFFSET` 拿当页，避免全表拉取后在 Node 过滤。

---

## 5. 唯一约束

单字段唯一与组合唯一统一走 `unique_values` 表：

1. 取该约束涉及字段的值，按字段顺序规范化（数值统一成十进制字符串、字符串保留原样）。
2. 计算 `SHA-256(JSON.stringify(values))` 作为 `values_hash`。
3. `unique_values` 上有 `(constraint_id, values_hash)` 唯一索引 —— 并发插入由数据库保证只能成功一条，
   冲突时把 `P2002` 翻译成业务错误 `DUPLICATE_UNIQUE_FIELD`。
4. 新建约束或切换 `isUnique` 时，对历史数据**分批回填**（500 条/批），
   任一批冲突则整体事务回滚并返回 `UNIQUE_CONSTRAINT_INVALID`，不会留下半成品约束。
5. 记录更新时按差异同步：先删旧 hash、再插新 hash，同一事务内完成。

> 为什么不用「查询后再插入」判断重复：那是有竞态的 check-then-act，
> 并发下必然漏判。把唯一性下沉到数据库索引是唯一可靠的方案。

---

## 6. 公式引擎

```
表达式文本
  → Tokenizer        词法切分（数字/字符串/字段引用/函数/运算符）
  → Parser           递归下降，产出 AST
  → Validator        字段存在性、类型检查、函数白名单、循环引用检测、表达式规范化
  → Dependency       按字段依赖建图 + 拓扑排序
  → Evaluator        无 eval 的树遍历求值
  → 物化             结果写回 record.data，错误写回 record.formulaErrors
```

要点：

- **不使用 `eval` / `new Function`**，求值器只认识白名单节点与函数。
- 规范化保留括号（`(a+b)*c` 不会被改写成 `a + b * c`）。
- 上游字段出错时，下游抛 `FORMULA_DEPENDENCY_ERROR` 而不是当成 0 继续算，
  前端/导出统一展示 `#VALUE!`。
- 只重算受影响字段（按变更字段反查依赖），重算成功后清除旧的 `formulaErrors`。
- 所有算术与函数结果都过 `ensureFinite()`，避免 `Infinity`/`NaN` 写进 JSON 变成 `null`。

---

## 7. 导入导出

- **导入**：ExcelJS 逐行读取 → 表头映射到 `fieldKey`（重复表头直接标出 `duplicateColumns`）
  → 元数据只加载一次 → 每行复用 `RecordsService.createPrepared()`（同一套校验/唯一约束/公式逻辑）
  → 末尾写一条 `RECORD_BATCH_CREATE` 汇总审计，而不是每行一条。
- **导出**：ExcelJS 流式写出，公式错误映射为 Excel 错误文本；
  文本以 `=` 开头时按纯文本写入，避免公式注入。

---

## 8. 前端架构

```
src/
  api/http.ts      axios 实例：请求头注入、响应解包、401 单飞刷新、并发去重
  api/index.ts     按领域分组的类型化接口
  stores/auth.ts   Pinia：用户、权限集合（Set）、can()、bootstrap()
  router/index.ts  路由守卫：首次 bootstrap 恢复会话 → 未登录跳转 → 权限不足回列表
  views/           9 个页面
  components/      字段管理、公式编辑器、导入、查询条件、记录编辑、单元格渲染
```

两个关键点：

1. **401 单飞刷新**：多个并发请求同时 401 时只发起一次 `/auth/refresh`，
   其余请求等待同一个 Promise，成功后统一用新 Token 重放。有 Vitest 用例锁定该行为。
2. **权限只用于隐藏入口**，真正的强制在后端。前端 `can()` 不参与任何安全决策。

---

## 9. 部署拓扑

```
docker compose
├── mysql      (healthcheck: mysqladmin ping)
├── backend    非 root 运行；入口脚本先 migrate deploy，再 exec node
└── nginx      多阶段构建：Node 编译前端 → 产物进 /usr/share/nginx/html
```

- 前端产物在**镜像构建期**生成，不再依赖「构建容器 + 共享卷」，
  消除「Nginx 已启动但产物还没拷完」的时序问题。
- 后端 `ENTRYPOINT` 用 `exec` 启动 Node，保证 `docker stop` 的 SIGTERM 直达进程，
  触发 Nest 的 `enableShutdownHooks()` 正常关闭连接池。
- `TRUST_PROXY=true` 让审计日志取到 Nginx 转发的真实客户端 IP。
