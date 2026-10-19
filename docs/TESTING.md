# 测试说明

## 1. 分层与当前规模

| 层 | 工具 | 位置 | 用例数 | 依赖 |
| --- | --- | --- | --- | --- |
| 后端单元测试 | Jest + ts-jest | `backend/test/*.spec.ts` | 50 | 无（纯函数 / 打桩） |
| 后端集成测试 | Jest + supertest | `backend/test/*.e2e-spec.ts` | 90 | 真实 MySQL + 完整 Nest 应用 |
| 前端单元测试 | Vitest + jsdom | `frontend/src/**/*.spec.ts` | 23 | 无 |

总计 **163** 个用例。

## 2. 本地运行

### 2.1 后端单元测试

```bash
cd backend
npm run test:unit          # 等价于 npm test
```

### 2.2 后端集成测试（需要真实 MySQL）

集成测试**不会**碰你的开发库：脚本默认连 `dms_test`，可用 `TEST_DATABASE_URL` 覆盖。

```bash
cd backend
# 例：本地临时 MySQL
export TEST_DATABASE_URL="mysql://root@127.0.0.1:3307/dms_test"
npm run test:e2e
```

执行流程：

1. `global-setup` 对测试库跑 `prisma migrate reset --force`（**会清空该库**）+ `prisma db seed`。
2. 两个套件按 `test/sequencer.js` 固定顺序执行：
   - `app.e2e-spec.ts`：主功能回归（Auth/RBAC、字段、记录、查询、公式、API Key、EXTERNAL、导入导出、审计、响应格式）
   - `security.e2e-spec.ts`：安全回归（会话失效、令牌重放、唯一约束回填、数值/日期严格校验、权限边界、分页稳定、健康检查）
3. `global-teardown` 断开连接。

> 为什么要固定顺序：安全套件会主动撤销会话、禁用账号来验证「即时失效」，
> 若先于主功能套件执行，会让后者的共享管理员会话成片 403 —— 这类失败与业务无关。

### 2.3 前端单元测试

```bash
cd frontend
npm run test        # vitest run
npm run test:watch
```

### 2.4 一次跑完

```bash
cd backend  && npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e && npm run build
cd frontend && npm run lint && npm run typecheck && npm run test && npm run build
```

### 2.5 性能基准（可选）

需要一个已迁移的空库，脚本会自行造 1 万条数据（重复执行会先清理自己的基准项目）：

```bash
cd backend
export DATABASE_URL="mysql://root@127.0.0.1:3307/dms_bench"
npx prisma migrate deploy
npm run bench
```

输出包含每类查询的 COUNT/SELECT 平均耗时，以及 `EXPLAIN` + `EXPLAIN ANALYZE`
（真实扫描行数、是否 filesort、是否走索引）。结果解读见 `docs/PROJECT_AUDIT.md` §5。

## 3. 测试覆盖的关键行为

这些用例不是「跑通就行」，每一条都对应一个曾经出错或容易出错的点：

- **并发刷新**：并发 3 个 `/auth/refresh`，只允许 1 个成功，其余 401。
- **令牌重放**：宽限期外重放已撤销令牌 → 该用户全部 Refresh Token 被撤销。
- **权限即时收敛**：角色降级后，用旧 Access Token 访问立即 403。
- **禁用账号**：`isActive=false` 后旧 Token 立即 401。
- **唯一约束回填**：历史数据有重复 → 创建约束失败且回滚；无重复 → 历史行全部回填成功。
- **eq 不退化为 LIKE**：`abc` 不应匹配 `ABC` / `abcd`。
- **公式**：括号保真、依赖错误传播、溢出拦截、错误清除。
- **分页稳定性**：空排序下连续翻页不重复不遗漏。
- **权限边界**：API Key 不能授予超出自身的 scope，不能用 API Key 管理 API Key。
- **前端 401 单飞**：并发 401 只触发一次刷新，重放后全部成功；刷新失败只尝试一次并跳登录。
- **前端权限判定**：`*` 通配、多权限全满足、多角色取并集。

## 4. CI

`.github/workflows/ci.yml` 四个 job：

| job | 内容 |
| --- | --- |
| `backend-static` | `npm ci` → `prisma generate` → lint → typecheck → 单元测试 → build |
| `backend-e2e` | MySQL 8.4 服务（healthcheck）+ 显式端口探活 → `npm run test:e2e` |
| `frontend` | `npm ci` → lint → typecheck → Vitest → build |
| `compose` | `docker compose config --quiet` + 构建 backend / nginx 镜像 |

npm 缓存按 `package-lock.json` 命中；同一分支的新提交会取消旧流水线。

## 5. 已知限制（不掩饰）

1. **Docker 镜像未在本机验证**：开发环境没有 Docker CLI，`compose` 相关改动仅经
   `docker compose config` 的静态校验思路设计，实际构建由 CI 的 `compose` job 承担。
2. **无浏览器 E2E**：未引入 Playwright，前端交互（拖拽、虚拟滚动、复杂表格操作）
   没有自动化回归，仅覆盖纯逻辑层。
3. **未做覆盖率门禁**：没有设置 coverage 阈值，避免为了数字写无意义断言。
4. **沙箱环境的特例**：在某些受限环境里 Vitest 并发写临时模块会失败，
   本项目已通过 `fileParallelism: false` 串行执行规避，正常开发机不受影响。
