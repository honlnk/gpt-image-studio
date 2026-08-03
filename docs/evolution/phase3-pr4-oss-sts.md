# 阶段三 PR4：OSS STS 临时凭证机制

> 状态：✅ 已完成
> 依赖：PR2（多租户 userId 已就位，OSS prefix 可按用户隔离）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三 D11

## 一、目标

服务器多用户模式下，OSS（选项 C）改为**平台统一配置 + STS 临时凭证**：
- 平台配置一个 OSS bucket，所有用户图片传到同一 bucket，按 `users/<user-id>/datasets/<dataset-id>/<blobKey>` 划分前缀。
- 长期 AccessKey 只存宿主，Companion 调宿主的 STS 签发接口拿临时凭证（15min~1h 有效期），用完自动续期。
- 宿主可随时停止签发新凭证，立即收回用户上传能力。

## 二、设计决策

### 2.1 STS 凭证缓存

**新建 `companion/src/storage/stsCredentials.ts`**：
```ts
export type StsCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  expiration: string;     // ISO8601
  bucket: string;
  region: string;
  prefix: string;         // 宿主限定的用户前缀
};

/** 从宿主获取 STS 凭证（带 5min 提前续期缓存）。 */
export async function getStsCredentials(userId: string): Promise<StsCredentials>;
```

实现：
- 内存缓存 `Map<userId, { creds, fetchedAt }>`。
- `getStsCredentials`：缓存命中且 `expiration - 5min > now` → 返回缓存；否则调宿主 `GET {MAIN_APP_URL}/api/sts/upload-token`（带 `MAIN_APP_API_KEY` + `X-User-Id`）。
- 宿主返回的 prefix 已限定该用户（`users/<userId>/`），Companion 据此拼 object key。

### 2.2 STS 感知的 OssImageStore

`createOssImageStore` 现在接受静态凭证。新增 `createStsOssImageStore`：
- 接收 `getStsCredentials` 回调 + userId。
- 每次 save/load/remove 前确保有有效 STS（惰性获取 + 过期续期）。
- STS 刷新后重建 ali-oss client（credential 变了）。

### 2.3 server 模式 buildImageStore 分流

`datasetRegistry.buildImageStore`：
- local 模式 OSS：沿用 `oss-credentials.json`（阶段二行为）。
- server 模式 OSS：用 `createStsOssImageStore`（STS）。

### 2.4 平台 OSS 配置（server 模式）

server 模式下 OSS 配置来源：
- 不再用 `oss-credentials.json`（那是本机模式用户自配）。
- STS 响应自带 bucket/region/prefix，Companion 不需要预知 OSS 配置——宿主全权决定。
- 环境变量 `MAIN_APP_URL` + `MAIN_APP_API_KEY`（Companion 调宿主用）。

## 三、改造清单

### 3.1 STS 凭证模块

**新建 `companion/src/storage/stsCredentials.ts`**（见 §2.1）。

**新建 `companion/src/storage/stsCredentials.test.ts`**：
- 缓存命中（未过期）
- 过期续期（expiration - 5min 内重新获取）
- 不同用户独立缓存
- 宿主接口失败 → 抛错
- mock fetch 验证请求头（Authorization + X-User-Id）

### 3.2 STS OssImageStore

**改 `companion/src/storage/ossImageStore.ts`**：
- 新增 `createStsOssImageStore(opts: { getUserId, getStsCredentials, clientFactory? })`。
- save/load/remove/estimateBytes 内部先 `await ensureStsClient()` 再操作。
- `ensureStsClient`：获取 STS（带缓存），STS 变了就重建 client。

### 3.3 buildImageStore 分流

**改 `companion/src/storage/datasetRegistry.ts`**：
- `buildImageStore` 加 `userId` 参数。
- OSS + server 模式（userId !== '__local__'）→ `createStsOssImageStore`。
- OSS + local 模式 → 沿用 `createOssImageStore` + `oss-credentials.json`。

### 3.4 环境变量校验

**改 `companion/src/server.ts`**：
- server 模式启动时若 `MAIN_APP_URL` 或 `MAIN_APP_API_KEY` 缺失，打印 warning（不阻断——filesystem 模式不需要 STS）。

## 四、验收门槛

- [ ] local 模式 OSS 仍走 `oss-credentials.json`（阶段二回归）
- [ ] server 模式 OSS 走 STS：调宿主接口拿临时凭证
- [ ] STS 凭证缓存：未过期用缓存，过期前 5min 续期
- [ ] 不同用户的 STS 凭证独立缓存（prefix 按 userId 隔离）
- [ ] 宿主接口失败 → 图片操作返回明确错误
- [ ] STS 响应的 prefix 透传到 OSS object key（用户隔离）
- [ ] `grep -r accessKeyId companion/src` 无明文长期 AK（只有 STS 临时 + oss-credentials.json 本机模式）
- [ ] `pnpm test` 全绿 + typecheck 无错

## 五、回滚策略

纯增量（新文件 `stsCredentials.ts` + ossImageStore 新函数）。回滚 = `git revert`。revert 后 server 模式 OSS 不可用（local 模式不受影响）。

## 六、实施记录

> （PR 合并后填写）
