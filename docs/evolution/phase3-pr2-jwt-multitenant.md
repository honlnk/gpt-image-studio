# 阶段三 PR2：JWT 认证中间件 + users 表多租户隔离

> 状态：✅ 已完成
> 依赖：PR1（部署形态开关已就位，server 模式可识别）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三 D9 + D10 SSO 登录部分

## 一、目标

在 server 部署形态下：
1. 用 JWT 验证中间件替换 accessKey 信任模型（accessKey 在 local 模式保留）。
2. 主 db 新增 `users` 表，`dataset_registry` 加 `user_id` 外键，业务 db 路径按用户隔离。
3. 所有 storage 路由从 JWT 拿 `user_id` 定位用户数据目录，实现多租户隔离。

**本 PR 完成后**：数据隔离已生效（A 用户看不到 B 用户数据），但 SLO 还没做（PR3 补吊销）。

## 二、设计决策

### 2.1 JWT 验签：HS256 + Node crypto（零依赖）

不引入 `jsonwebtoken`/`jose` 依赖。Companion 只做**验签 + 过期检查**（不签发），用 Node 内置 `crypto.createVerify`/`createHmac` 实现 HS256 验证（~40 行）。理由：
- 项目理念是"自建代码优于引入大库"（AGENTS.md 明确 ZIP/base64/图片尺寸都是自建）。
- 验签逻辑简单固定（HS256 = HMAC-SHA256），引入库收益不大。
- 减少依赖 = 减少 supply chain 风险。

### 2.2 users 表 + dataset_registry.user_id 迁移

`schema.ts` `MASTER_DB_VERSION` 从 1 升到 2。迁移 DDL：
```sql
-- v2 新增
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,        -- 来自 JWT sub
  display_name TEXT NOT NULL DEFAULT '', -- 来自 JWT display_name claim
  created_at   TEXT NOT NULL
);

-- dataset_registry 加 user_id 列（向后兼容：默认 __local__）
ALTER TABLE dataset_registry ADD COLUMN user_id TEXT NOT NULL DEFAULT '__local__';
CREATE INDEX IF NOT EXISTS idx_registry_user ON dataset_registry(user_id);
```

`user_id = '__local__'` 是 local 模式的虚拟用户（阶段二已有的数据集全部归到此用户），保证 local 模式零迁移成本。

**指纹唯一性调整**：原 `fingerprint UNIQUE` 改为 `(user_id, fingerprint) UNIQUE`——不同用户可以有相同配置（如都选默认目录）但不冲突。旧唯一索引在迁移时删除重建。

### 2.3 业务 db 路径隔离

```
local 模式（向后兼容）：
  <CONFIG_DIR>/datasets/<dataset-id>.db          ← 不变

server 模式：
  <CONFIG_DIR>/users/<user-id>/datasets/<dataset-id>.db
```

`datasetRegistry.resolveAndActivate` 接收 `userId` 参数，据此决定 `dbPath`。local 模式 `userId='__local__'` 时路径退化为旧结构（零破坏）。

### 2.4 认证中间件双模式

`authMiddleware` 改造为接收 deployment config：
- **local 模式**：行为同阶段二（accessKey bearer 验证）。`req.user = { userId: '__local__' }`。
- **server 模式**：JWT 验证（HS256 + exp 检查）。`req.user = { userId: jwt.sub, displayName: jwt.display_name }`。accessKey 仍可作为管理凭证（CLI/运维），但普通数据请求走 JWT。

JWT 密钥来源：`process.env.JWT_SECRET`（server 模式必填，缺失则启动报错）。

## 三、改造清单

### 3.1 新建 JWT 验签模块

**新建 `companion/src/auth/jwt.ts`**：
```ts
export type JwtPayload = {
  sub: string;            // user_id（必填）
  display_name?: string;  // 显示名（可选）
  jti?: string;           // JWT 唯一 id（PR3 吊销用）
  exp?: number;           // 过期时间（Unix 秒）
  iat?: number;
};

/** 验证 HS256 JWT。返回 payload 或抛错。 */
export function verifyJwt(token: string, secret: string): JwtPayload;
```

实现要点：
- 分割 `header.payload.signature`，三段都用 base64url。
- 重新计算 `HMAC-SHA256(header.payload, secret)`，与 signature **常数时间比较**（防时序攻击，用 `crypto.timingSafeEqual`）。
- 检查 `alg === "HS256"`（防 alg=none 绕过）。
- 检查 `exp`：当前时间 > exp 则抛"token 过期"。

**新建 `companion/src/auth/jwt.test.ts`**：
- 有效 JWT 验证通过
- 错误 secret → 抛错
- 篡改 payload → 签名不匹配 → 抛错
- `alg: none` → 拒绝
- 过期 exp → 抛错
- 无 exp → 通过（允许长期 token，由宿主控制）
- 用 Node `crypto.createHmac` 生成测试用 JWT（自建测试工具，不引库）

### 3.2 主 db schema 迁移（v1→v2）

**改 `companion/src/storage/schema.ts`**：
- `MASTER_DB_VERSION = 2`
- 新增 `MASTER_DB_MIGRATION_V2` DDL（users 表 + ALTER + 索引重建）
- `MASTER_DB_DDL` 同步加 users 表（新库直接建 v2）

**改 `companion/src/storage/db.ts`**：
- `openMasterDb` 里 `user_version` 升级逻辑：v1→v2 时执行 `MASTER_DB_MIGRATION_V2`。
- 新增 `users` 表 CRUD：`insertUser`, `getUser`, `listUsers`。
- `dataset_registry` 相关函数加可选 `userId` 参数：
  - `findDatasetByFingerprint(fingerprint, userId)` — SQL 加 `WHERE user_id = ?`
  - `getActiveDataset(userId)` — SQL 加 `WHERE user_id = ? AND is_active = 1`
  - `listDatasets(userId)` — SQL 加 `WHERE user_id = ?`
  - `activateDataset(id, now, userId)` — 事务里 `WHERE user_id = ?` 限定重置范围
  - `insertDataset` — record 加 `user_id` 字段
  - `deleteDataset`, `renameDataset` — 加 `userId` 参数防越权

### 3.3 datasetRegistry 接入 userId

**改 `companion/src/storage/datasetRegistry.ts`**：
- `ResolveInput` 加 `userId: string`（必填）。
- `resolveAndActivate` 用 `input.userId` 定位用户目录 + 传给 db 函数。
- `dbPath` 计算：`userId === '__local__'` ? `datasets/<id>.db` : `users/<userId>/datasets/<id>.db`
- `getActiveImageStore(userId)` — 加参数。
- `ensureDefaultDataset(userId?)` — local 模式不传，server 模式传当前用户。
- `listDatasetViews(userId)`, `getDatasetView(id, userId)`, `deleteDatasetCascade(id, userId)`, `renameDatasetView(id, label, userId)` — 全部加 userId。

### 3.4 认证中间件双模式

**改 `companion/src/middleware/auth.ts`**：
```ts
export function authMiddleware(app: FastifyInstance, opts: {
  mode: DeploymentMode;
  jwtSecret?: string;     // server 模式必填
}) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.includes(req.url)) return;
    if (LOOPBACK_GUARDED_PREFIXES.some(p => req.url.startsWith(p))) return;

    if (opts.mode === "server") {
      // JWT 验证
      const token = extractBearer(req);
      if (!token) return reply.status(401).send({ error: "未授权：缺少 JWT" });
      try {
        const payload = verifyJwt(token, opts.jwtSecret!);
        req.user = { userId: payload.sub, displayName: payload.display_name };
      } catch (e) {
        return reply.status(401).send({ error: "JWT 验证失败" });
      }
    } else {
      // local 模式：accessKey 验证（阶段二行为）
      ... 现有逻辑 ...
      req.user = { userId: "__local__" };
    }
  });
}
```

**Fastify 类型扩展**：在 `companion/src/types.ts` 加 `declare module "fastify"` 扩展 `FastifyRequest.user`。

### 3.5 users 表懒创建

**新建 `companion/src/storage/users.ts`**（或在 db.ts 内）：
```ts
/** 首次见到 userId 时懒创建 user 记录 + 建用户目录。 */
export function ensureUser(userId: string, displayName: string): void {
  const existing = getUser(userId);
  if (existing) {
    // 更新 display_name（JWT claim 可能变）
    if (displayName && displayName !== existing.display_name) {
      updateUserDisplayName(userId, displayName);
    }
    return;
  }
  insertUser({ id: userId, display_name: displayName, created_at: new Date().toISOString() });
  // 建用户目录
  mkdirSync(join(CONFIG_DIR, "users", userId, "datasets"), { recursive: true, mode: 0o700 });
}
```

JWT 中间件验证通过后调用 `ensureUser`（server 模式）。

### 3.6 storage 路由接入 req.user

**改 `companion/src/routes/storage.ts`**：
- 所有 `getActiveImageStore()` → `getActiveImageStore(req.user.userId)`
- `requireActive(reply)` → `requireActive(req, reply)`，内部用 `req.user.userId`
- `listDatasetViews()` → `listDatasetViews(req.user.userId)`
- `resolveAndActivate(input)` → input 加 `userId: req.user.userId`
- `deleteDatasetCascade(id)` → 加 `req.user.userId`（防越权删别人数据集）
- `renameDatasetView` 同理
- 数据集管理路由加越权校验：操作 `:id` 数据集前确认它属于 `req.user.userId`

### 3.7 server.ts 启动校验

**改 `companion/src/server.ts`**：
- 接收 `deployment: DeploymentConfig`。
- server 模式启动时校验 `JWT_SECRET` 环境变量存在，否则抛错退出。
- `authMiddleware(app)` → `authMiddleware(app, { mode: deployment.mode, jwtSecret: process.env.JWT_SECRET })`。

### 3.8 /auth/me 端点（PR3 完善吊销检查，本 PR 先返回 user 信息）

**改 `companion/src/routes/auth.ts`**：
- 新增 `GET /auth/me`：返回 `{ userId, displayName }`（从 `req.user` 读）。前端用它确认登录态。
- 本 PR 不做吊销检查（PR3 补），只返当前 JWT 解析出的 user。

## 四、验收门槛

### 功能验证

- [ ] local 模式：accessKey 验证行为同阶段二，`req.user.userId = '__local__'`，所有数据路径不变
- [ ] server 模式无 JWT_SECRET 启动 → 报错退出
- [ ] server 模式 + 有效 JWT → 请求通过，`req.user.userId` = JWT sub
- [ ] server 模式 + 无效签名 JWT → 401
- [ ] server 模式 + 过期 JWT → 401
- [ ] server 模式 + `alg: none` JWT → 401
- [ ] server 模式 + 无 Authorization 头 → 401

### 多租户隔离验证

- [ ] 用户 A 的 JWT 访问 storage，只能看到 A 的数据集（`user_id = A`）
- [ ] 用户 B 的 JWT 访问同一端点，只能看到 B 的数据集
- [ ] 用户 A 尝试操作 B 的数据集 id → 404/403（越权防护）
- [ ] 业务 db 物理路径：A 的数据在 `users/A/datasets/`，B 的在 `users/B/datasets/`
- [ ] 首次见到的 userId 自动懒创建 user 记录 + 目录
- [ ] `GET /auth/me` 返回当前 JWT 的 userId + displayName

### 回归验证

- [ ] `pnpm test` 全绿（含 schema 迁移测试、jwt 测试、多租户隔离测试）
- [ ] `pnpm typecheck` + `pnpm typecheck:companion` 无错
- [ ] local 模式阶段二功能 100% 回归

## 五、新增测试

- `companion/src/auth/jwt.test.ts`（§3.1 列出的 7 个用例）
- `companion/src/storage/db.test.ts` 扩展：users 表 CRUD、v1→v2 迁移、`userId` 限定的 dataset 查询
- `companion/src/storage/datasetRegistry.test.ts` 扩展：多租户隔离（两个 userId 各自独立数据集）
- 新建 `companion/src/middleware/auth.test.ts`：双模式认证（local accessKey + server JWT）

## 六、回滚策略

schema 迁移是单向的（v1→v2）。回滚 = `git revert` 代码 + 手动 `PRAGMA user_version = 1`（开发阶段数据可丢弃）。生产环境迁移前应备份数据目录。`user_id` 列默认值 `'__local__'` 保证回滚后旧代码仍能读数据（只是忽略 user_id 列）。

## 七、实施记录

> （PR 合并后填写）
