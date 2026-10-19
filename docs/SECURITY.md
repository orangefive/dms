# 安全设计说明

> 本文描述系统当前实现的防护与仍然存在的风险。写在这里的每一条都对应可验证的代码或测试，
> 未实现的部分集中在 §9，不做「已全面加固」之类的笼统声明。

## 1. 认证与会话

### 1.1 双令牌模型

| 令牌 | 载体 | 有效期 | 存储 |
| --- | --- | --- | --- |
| Access Token | `Authorization: Bearer` | 30 分钟（可配） | 仅前端内存（Pinia / 模块变量），不进 localStorage |
| Refresh Token | `httpOnly` Cookie | 7 天（可配） | 服务端只存 `SHA-256(pepper + token)`，`HttpOnly` + `SameSite=Lax` + `Secure` 可配 |

Access Token 只在前端内存中，页面刷新后靠 Refresh Token 重新换取 ——
XSS 无法从存储里直接读出长期凭证。

### 1.2 刷新令牌轮换与并发

每次刷新都会签发新令牌并撤销旧令牌，撤销是**原子**的：

```ts
const consumed = await tx.refreshToken.updateMany({
  where: { id, revokedAt: null, expiresAt: { gt: now } },
  data: { revokedAt: now, replacedBy: newTokenId },
});
if (consumed.count !== 1) {
  // 已经被别的请求消费掉：判定为重放
}
```

- 并发场景下 `count === 1` 的只有一个请求，其余拿到 401 —— 不会产生两个并行会话。
- 失败方**不会**去撤销胜者的令牌（避免正常并发被误判为攻击）。
- 若令牌已撤销且撤销时间超过 30 秒，视为泄露重放：撤销该用户**全部** Refresh Token，
  强制所有设备重新登录。

测试覆盖：`security.e2e-spec.ts` 的「并发刷新单一成功」「宽限期外重放撤销全部」。

### 1.3 会话即时失效

`AuthGuard` 在验签之后**再查一次库**，因此：

- 账号被禁用 → 下一次请求立即 401，不等 Access Token 过期。
- 角色被调整 → 权限立即收敛（`isLastActiveAdmin` 也只统计启用中的管理员，避免锁死系统）。
- 管理员重置某用户密码或禁用该用户时，在同一事务内撤销其全部 Refresh Token。

## 2. 授权（RBAC）

权限编码目录集中在 `src/common/permissions.ts`，角色是权限的集合：

| 角色 | 权限 |
| --- | --- |
| `ADMIN` | `*`（全部） |
| `DEVELOPER` | 项目/表/字段/记录/公式/导入导出等读写权限 |
| `VIEWER` | 只读类权限 |

前端 `can()` 只用于隐藏入口；**强制点在后端** `PermissionsGuard`，与 `@RequirePermissions()` 声明比对。
权限集合每次请求从数据库实时计算，不来自 Token 快照。

## 3. API Key

- 明文只在创建时返回一次，库里存哈希 + 前缀（`key_prefix` 用于界面识别）。
- 每个 Key 有 `scopes`；请求时按 scope 授权，与用户权限互不提升。
- **API Key 不能管理 API Key**（`requireUser()`），也不能授予超出创建者自身权限的 scope
  （`assertCanGrantScopes()`）。
- `lastUsedAt` 每分钟最多落库一次，避免高频调用打爆写库。

## 4. 生产配置 fail-fast

`src/config/env.validation.ts` 在应用启动时校验，不满足直接退出（而不是降级运行）：

- `NODE_ENV=production` 时 `JWT_SECRET` / `JWT_REFRESH_SECRET` / `API_KEY_SECRET` 必须存在；
- 长度 ≥ 32，且不能以 `please_change_me` / `dev_` / `change_me` 开头；
- 三者必须互不相同；
- `CORS_ORIGIN` 不允许 `*`；
- `DATABASE_URL` 必须以 `mysql://` 开头；
- 布尔变量只接受 `true/false/1/0`（修复了 `"false"` 被当成 `true` 的历史缺陷）。

## 5. SQL 注入防护（多层）

1. **值永远参数化**：所有用户输入都通过 `Prisma.sql` 占位符传入，不存在字符串拼接值。
2. **标识符白名单**：表名/字段名来自元数据，且必须匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/`。
   动态标识符无法参数化，因此这一层是必需的，而不是冗余。
3. **EXTERNAL 表列校验**：先查 `information_schema.columns`，只允许真实存在的列进入编译器。
4. **操作符白名单**：未知操作符直接拒绝，不会透传到 SQL。
5. **类型约束**：`NUMBER` 字段禁止 `LIKE`；数值/日期在编译前做严格校验
   （拒绝 `0x10`、`Infinity`、`NaN`、`2026-02-31`）。

## 6. 并发与数据完整性

- 唯一性下沉到数据库唯一索引（`unique_values(constraint_id, values_hash)`），
  而不是「先查再插」的 check-then-act。
- 冲突（`P2002`）统一翻译为业务错误 `DUPLICATE_UNIQUE_FIELD` / `UNIQUE_CONSTRAINT_INVALID`。
- 新增唯一约束时对历史数据分批回填，冲突则整体回滚，不会留下「看起来生效但历史数据不合规」的约束。
- 并发 `upsert` 遇到唯一冲突时重新定位记录再走更新路径，避免重复插入。

## 7. 输入与输出

- 全局 `ValidationPipe`：`whitelist: true` + `forbidNonWhitelisted: true`，
  未声明字段直接 400（也有测试断言 `UNKNOWN_FIELD_IN_DATA`）。
- 导入：重复表头显式报出（`duplicateColumns`），不会静默覆盖。
- 导出：以 `=` 开头的文本按纯文本写入，防止 CSV/Excel 公式注入。
- 响应统一 `{ success, data }` / `{ success: false, error: { code, message } }`，
  错误信息不包含堆栈或 SQL 细节。

## 8. 部署与传输

- 后端容器以非 root 用户运行，自带 `HEALTHCHECK`。
- Nginx 统一注入 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、
  `Permissions-Policy`；`/assets/` 因 `add_header` 不继承而单独 include 一份。
- 反向代理场景通过 `TRUST_PROXY=true` 取真实客户端 IP，审计日志记录可信来源。
- 支持 HTTPS 部署时把 `COOKIE_SECURE=true` 打开（HttpOnly Cookie 才会带 Secure 标记）。

## 9. 仍然存在的风险（明确列出）

| 风险 | 现状 | 建议 |
| --- | --- | --- |
| 限流是进程内存实现 | 单实例有效，多副本不共享计数 | 多副本时把 `@nestjs/throttler` 存储换成 Redis |
| 未设置 CSP | 只设置了基础安全响应头 | 引入 CSP 需同时处理 Element Plus 的 inline style，建议单独一轮联调 |
| 字段级索引未实现 | `isIndexed` 开关无后端行为 | 见 `docs/PROJECT_AUDIT.md` §6 |
| 审计日志无保留策略 | 只做写入与查询 | 按合规要求加归档/清理任务 |
| 无登录失败锁定 | 仅靠限流（默认每分钟有限次数） | 需要更强防护时按账号/IP 增加失败计数与锁定 |
| Swagger 默认在 Compose 中开启 | 便于演示，暴露接口结构 | 公网部署时设 `SWAGGER_ENABLED=false` |

## 10. 安全回归测试

`backend/test/security.e2e-spec.ts` 覆盖：

- 禁用账号后旧 Access Token 立即 401；
- 角色降级后权限即时收敛；
- 并发刷新只成功一次；
- 宽限期外重放撤销全部会话；
- 唯一约束回填的失败回滚与成功路径；
- 记录字段显式 `null` 的清空语义；
- 数值/日期的严格校验；
- API Key 的权限边界；
- 分页稳定性；
- 健康检查在数据库不可用时返回 503。
