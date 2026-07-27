# 阶段三 PR3：吊销黑名单 SLO + /admin/revoke

> 状态：⬜ 待启动
> 依赖：PR2（JWT 中间件 + req.user 已就位）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三 D10 SLO 部分

## 一、目标

补全 D10 完整 SSO 的**单点登出（SLO）**能力：
1. 新增 `/admin/revoke` 端点（平台级管理密钥鉴权），支持用户级 + JWT 级吊销。
2. 内存级吊销黑名单（Map + TTL 自动清理），JWT 中间件验证时检查黑名单。
3. `/auth/me` 增加吊销检查（被吊销的 user/jti 返回 401）。

**本 PR 完成后**：用户在宿主登出/封禁/改密后，宿主调 `/admin/revoke`，Companion 立即拒绝该用户后续请求。

## 二、设计决策

### 2.1 内存级黑名单（纯内存 + TTL）

- 数据结构：`Map<string, number>`，key = `user:<userId>` 或 `jti:<jti>`，value = 过期 Unix 秒。
- TTL：每条记录带 `expireAt`（= JWT 原本的 exp，或吊销时刻 + 最大 JWT 有效期）。过期项由后台定时清理。
- 重启清空：进程重启后黑名单丢失，但 JWT 有效期短（≤1h），残留风险窗口 = 剩余有效期，可接受（D10 决策）。
- 查询：O(1) Map 查找。请求时检查 `user:<userId>` 和 `jti:<jti>`（若有）是否在黑名单且未过期。

### 2.2 /admin/revoke 端点

```
POST /admin/revoke
Authorization: Bearer <ADMIN_API_KEY>   ← 平台级管理密钥（区别于用户 JWT）
Content-Type: application/json

{
  "user_id": "xxx",          // 可选：按用户吊销（登出/封禁）
  "jwt_jti": "xxx",          // 可选：按单个 JWT 吊销（粒度更细）
  "ttl_seconds": 3600        // 可选：黑名单保留时长（默认 = JWT 最大有效期）
}
```

至少传 `user_id` 或 `jwt_jti` 之一。响应 `{ ok: true, revoked: ["user:xxx"] }`。

### 2.3 平台级管理密钥

`ADMIN_API_KEY` 环境变量（server 模式必填）。`/admin/revoke` 用单独的 bearer 验证（不走 JWT 中间件，也不走 accessKey）。

### 2.4 authMiddleware 集成吊销检查

JWT 验签通过后、挂载 req.user 前，检查黑名单：
- 若 `user:<sub>` 在黑名单且未过期 → 401 "用户已被吊销"。
- 若 JWT 有 `jti` 且 `jti:<jti>` 在黑名单且未过期 → 401 "令牌已被吊销"。

## 三、改造清单

### 3.1 新建吊销黑名单模块

**新建 `companion/src/auth/revocationList.ts`**：
```ts
/** 吊销黑名单（内存级，TTL 自动清理）。 */
export const revocationList = {
  /** 按用户吊销。ttlSeconds 后自动失效。 */
  revokeUser(userId: string, ttlSeconds: number): void;
  /** 按 JWT jti 吊销。 */
  revokeJti(jti: string, ttlSeconds: number): void;
  /** 检查用户是否被吊销。 */
  isUserRevoked(userId: string): boolean;
  /** 检查 jti 是否被吊销。 */
  isJtiRevoked(jti: string): boolean;
  /** 启动后台清理定时器（进程级单例）。 */
  startCleanupTimer(): void;
  /** 停止清理定时器（测试用）。 */
  stopCleanupTimer(): void;
  /** 清空黑名单（测试用）。 */
  clear(): void;
};
```

实现：
- `Map<string, number>` 存 `key → expireAtUnixSec`。
- `isXxxRevoked`：查 Map，key 不存在或 `expireAt < now` 返回 false（过期的视为未吊销）。
- `startCleanupTimer`：`setInterval` 每 5 分钟扫一遍删过期项。

### 3.2 新建 /admin/revoke 路由

**新建 `companion/src/routes/adminRevoke.ts`**：
```ts
export async function adminRevokeRoutes(app: FastifyInstance) {
  app.post("/admin/revoke", async (req, reply) => {
    // 平台级密钥验证（不走 authMiddleware，独立验证）
    if (!validateAdminApiKey(req)) return reply.status(401)...;
    const body = req.body;
    // 校验 + 调 revocationList
    // 返回 { ok, revoked: [...] }
  });
}
```

`validateAdminApiKey`：读 `process.env.ADMIN_API_KEY`，与 bearer 比对（timingSafeEqual）。

### 3.3 authMiddleware 集成吊销检查

**改 `companion/src/middleware/auth.ts`**：
JWT 验签通过后：
```ts
if (revocationList.isUserRevoked(payload.sub)) {
  return reply.status(401).send({ error: "用户已被吊销" });
}
if (payload.jti && revocationList.isJtiRevoked(payload.jti)) {
  return reply.status(401).send({ error: "令牌已被吊销" });
}
```

### 3.4 server.ts 注册路由 + 启动清理

**改 `companion/src/server.ts`**：
- 注册 `adminRevokeRoutes`（在 authMiddleware 之前，自带密钥验证，不走 JWT）。
- server 模式启动时校验 `ADMIN_API_KEY` 存在 + `revocationList.startCleanupTimer()`。
- `/admin/revoke` 加入 `LOOPBACK_GUARDED_PREFIXES`? 不——它走平台密钥，不是 loopback。但要在 authMiddleware 的跳过列表里加 `/admin/revoke`（否则会被 JWT 中间件拦）。

### 3.5 /auth/me 吊销检查

`/auth/me` 走 authMiddleware，所以 JWT 验证时已经检查了吊销。被吊销的用户会在中间件层就被 401 拦截，不会到 `/auth/me`。无需额外改动（PR2 的 `/auth/me` 已通过中间件）。

## 四、验收门槛

- [ ] `/admin/revoke` 无 ADMIN_API_KEY → 401
- [ ] `/admin/revoke` 错误密钥 → 401
- [ ] `/admin/revoke` 正确密钥 + `{user_id}` → 200，该用户后续 JWT → 401
- [ ] `/admin/revoke` 正确密钥 + `{jwt_jti}` → 200，该 jti 后续请求 → 401（其他 jti 不受影响）
- [ ] 吊销的 TTL 过期后，用户/JTI 恢复访问（黑名单自动清理）
- [ ] `/auth/me` 被吊销用户 → 401
- [ ] local 模式不受影响（吊销只在 server 模式生效）
- [ ] 重启后黑名单清空（被吊销用户恢复，直到再次吊销——符合 D10 决策）
- [ ] `pnpm test` 全绿 + typecheck 无错

## 五、新增测试

- `companion/src/auth/revocationList.test.ts`：revokeUser/revokeJti/isRevoked/TTL 过期/clear/清理定时器
- `companion/src/routes/adminRevoke.test.ts`：端到端（正确/错误密钥、user_id/jti 吊销、吊销后请求被拒）
- `companion/src/middleware/auth.test.ts` 扩展：server 模式吊销后 JWT → 401

## 六、回滚策略

纯增量（新文件 `revocationList.ts` + `adminRevoke.ts`）。回滚 = `git revert`。revert 后回到 PR2（JWT 验证但不检查吊销）。

## 七、实施记录

> （PR 合并后填写）
