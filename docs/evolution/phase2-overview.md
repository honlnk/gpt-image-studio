# 阶段二：Companion 后端化（真实数据）—— 总览

> **状态：✅ 已完成（2026-07-27）**
>
> 对应纲领：[`evolution-roadmap.md` 第七章](../evolution-roadmap.md#七阶段二companion-后端化真实数据)
>
> 前置：阶段一已完成（`StudioStorage` 抽象层就位，`CompanionStorage` 是 throw 骨架）。

## 1. 目标（一句话）

让 Companion 从「无状态代理」升级为「真实数据后端」：Web 端切到 Companion 模式时，整个存储机制（会话/消息/图片元数据/设置/草稿/分析事件/图片二进制）都走 Companion，而不是只代理模型调用。

业务代码（store/service/组件）零改动——阶段一的 `StudioStorage` 接口已经把后端形态抽象掉了，本阶段只换实现。

## 2. Companion 现状基线（探查结论）

详细探查见附录 A，关键事实（决定阶段二施工方式）：

| 维度 | 现状 | 对阶段二的影响 |
|---|---|---|
| 技术栈 | Node ≥20 ESM + Fastify 5 + TypeScript 6（`companion/src/`） | D3 已定不重写，沿用 |
| 持久化 | **零数据库**，全部是 `~/.gpt-image-studio/` 下的明文 JSON 文件（`credentials.json`、`access-key.json`、`companion.pid`、`logs/`），文件权限 0600/0700 | 阶段二**首次引入 SQLite**，需新增 `better-sqlite3` 依赖 |
| API 风格 | 模块级常量 + 函数式导出（无类、无 DI 容器），路由直接 `import` 函数 | SQLite store 沿用同一模式：模块级单例 + 函数式导出，调用方零改动 |
| I/O 风格 | 全同步（`writeFileSync`/`readFileSync`） | better-sqlite3 也是同步 API，风格一致 |
| 配置来源 | CLI 参数（`--port`/`--channel`/`--allow-origin`）+ 3 个环境变量 + 硬编码常量，**无配置文件** | 阶段二存储配置（数据目录、OSS 凭据）进主 db 的 `dataset_registry`，不引入新配置文件 |
| 测试基建 | vitest 4（在 monorepo 根），用例通过 `GPT_IMAGE_STUDIO_CONFIG_DIR` 临时目录隔离 + `vi.resetModules()` | SQLite 测试直接沿用：db 文件放进 tempDir |
| 错误边界 | `CredentialStoreError` + `storeRouteWrapper.ts` 的 `handleStoreError` | SQLite 层抛同构错误类型，route 层错误处理不动 |
| 监听 | 硬编码 `127.0.0.1:19750` | 阶段二保持 loopback（服务器模式是阶段三的事） |
| 鉴权 | 双轨：`/credentials/*` + `/admin/*` 走 loopbackGuard，其余走 bearer accessKey | 阶段二新增的 `/storage/*` 路由走 bearer accessKey（数据面），管理面操作（数据集切换、OSS 配置）走 loopbackGuard |
| 损坏恢复 | `credentials.ts` 有约 200 行的「备份 .corrupt + 内存事件 + reset/restore」机制 | SQLite 事务保证原子性，这套机制在凭据层保留不动；新存储层**不复制**此机制（SQLite 自身有 WAL） |

**关键结论**：阶段二是 Companion 首次承载真实业务数据，但 Companion 的代码组织风格（函数式、同步 I/O、模块级单例）与 SQLite 的使用方式天然契合，改动可高度内聚。

## 3. 存储形态设计（沿用第七章，落地 schema）

### 3.1 结构化数据：SQLite 双层结构（D7 落地）

```
~/.gpt-image-studio/
├── studio.db                          ← 主 db（极小，几条记录）
│   └── dataset_registry 表
├── datasets/
│   ├── <dataset-id-1>.db              ← 业务 db（每个数据集一个独立文件）
│   ├── <dataset-id-2>.db              ← 内部 schema = 7 张业务表，无 dataset_id
│   └── ...
├── images/                            ← 选项 B 的默认图片目录
├── credentials.json                   ← 既有，不动（provider 凭据 + 阶段二新增 OSS AccessKey）
├── access-key.json                    ← 既有，不动
├── companion.pid                      ← 既有，不动
└── logs/                              ← 既有，不动
```

**两层职责**：
- **主 db `studio.db`**：只有一张 `dataset_registry` 表。即使业务 db 损坏也不影响 registry。
- **业务 db `datasets/<id>.db`**：每个数据集独立文件，schema = 7 张业务表，**不加 `dataset_id`**。

### 3.2 业务表 schema（解决未决问题「业务 db 的 SQLite schema 细节」）

设计原则：**镜像 IndexedDB 现有结构**，让 `StudioStorage` 的 5 个 CRUD 方法语义无缝映射。每张表 = 一个 keyPath + 一个 value 列（存 JSON 序列化后的完整对象），而非把对象字段拆成关系列。

理由：
- `StudioStorage.put(value)` 是 upsert 整个对象，调用方不关心字段；
- 业务对象（`Conversation` / `Message` / `ImageAsset` / `GenerationParams` / `AppSettings` / 草稿 / 分析事件）字段会随业务演进，拆成关系列会让 schema 迁移成为常态；
- IndexedDB 就是「key + value」模型，SQLite 用同样的模型承接，迁移路径最短。

```sql
-- 通用业务表模板（7 张表结构一致，仅 keyPath 不同）
CREATE TABLE IF NOT EXISTS <store_name> (
  key   TEXT PRIMARY KEY,   -- 对应 IndexedDB 的 keyPath
  value TEXT NOT NULL       -- JSON.stringify(对象)
);

-- 7 张业务表的 keyPath（与 IndexedDB 实现 IndexedDbStorage 对齐）
-- conversations:      key = conversation.id
-- messages:           key = message.id
-- imageAssets:        key = imageAsset.id
-- imageBlobs:         key = imageBlobRecord.key  （注：仅当 storageLocation=B 时存；A/C 模式此表为空，图片走文件/OSS）
-- settings:           key = settings.id（单记录，固定 key "__app_settings__"）
--                     + config 命名空间：key 以 "__config__:" 前缀
-- conversationDrafts: key = draft.conversationId
-- analyticsEvents:    key = event.id
```

**`imageBlobs` 表的特殊处理**：
- 选项 B（默认二进制）：图片二进制存 `~/.gpt-image-studio/images/<blobKey>`，`imageBlobs` 表**不存 blob 本体**，只存元信息 `{ key, size, mimeType, createdAt }`（用于容量估算）。
- 选项 A（指定目录）：图片存用户目录，`imageBlobs` 表为空。
- 选项 C（OSS）：图片存 OSS，`imageBlobs` 表为空。
- 这样 `StudioStorage.saveImageBlob/loadImageBlob` 在 Companion 模式下走图片 adapter，不进 SQLite——与 IndexedDB 实现的语义一致（imageBlobs 在 IndexedDB 里也是独立 store，不与元数据混）。

**schema 迁移版本管理**：用 SQLite 的 `PRAGMA user_version`。初始版本 = 1。未来加字段或索引时递增，在 `openBusinessDb()` 内按 version 分支迁移。

### 3.3 主 db schema（解决未决问题「dataset_registry 的 schema 细节」）

```sql
-- ~/.gpt-image-studio/studio.db
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS dataset_registry (
  id              TEXT PRIMARY KEY,          -- uuid，数据集唯一标识
  label           TEXT NOT NULL,             -- 用户可见名称（默认 = 存储位置描述，用户可改）
  storage_kind    TEXT NOT NULL,             -- 'filesystem' | 'oss'
  storage_config  TEXT NOT NULL,             -- JSON：{ directory?, defaultSubdir? } | { endpoint, bucket, prefix }
  fingerprint     TEXT NOT NULL UNIQUE,      -- 配置指纹（见 §3.4），用于去重
  db_path         TEXT NOT NULL,             -- 业务 db 的绝对路径（datasets/<id>.db）
  image_store_kind TEXT NOT NULL,            -- 'filesystem-default' | 'filesystem-custom' | 'oss'
                                          --   = 选项 B / 选项 A / 选项 C
  created_at      TEXT NOT NULL,             -- ISO timestamp
  activated_at    TEXT NOT NULL,             -- ISO timestamp，最近一次激活时间
  is_active       INTEGER NOT NULL DEFAULT 0 -- 0 | 1，阶段二本机模式同时只有一个 active
);

CREATE INDEX IF NOT EXISTS idx_registry_active ON dataset_registry(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_fingerprint ON dataset_registry(fingerprint);
```

**字段说明**：
- `storage_kind` + `storage_config`：描述图片存哪。`storage_config` 是 JSON 字符串，filesystem 模式 = `{ directory: "/abs/path" }`，oss 模式 = `{ endpoint, bucket, prefix }`（**不含 AccessKey**，AccessKey 在 `credentials.json`）。
- `image_store_kind`：冗余字段，便于 UI 直接显示「默认目录 / 自定义目录 / OSS」三种标签，无需反解 storage_config。
- `fingerprint`：唯一索引，保证「同一配置只创建一个数据集」（D7 配置去重）。
- `is_active`：本机模式同时只有一个数据集 active。切换数据集 = UPDATE 旧的 is_active=0 + 新的 is_active=1 + 更新 activated_at。

### 3.4 配置指纹归一化规则（解决未决问题「指纹归一化规则」）

```ts
// companion/src/storage/fingerprint.ts
function computeFingerprint(kind: 'filesystem' | 'oss', config: StorageConfig): string {
  if (kind === 'filesystem') {
    // normalize(目录绝对路径)：realpathSync 解软链 + 去尾部斜杠 + 小写化（macOS/Windows 大小写不敏感盘）
    return `fs:${normalizeDirectory(config.directory)}`;
  }
  // oss：endpoint + bucket + prefix，不含 AccessKey
  const normalizedEndpoint = config.endpoint.replace(/\/+$/, '').toLowerCase();
  const normalizedBucket = config.bucket.toLowerCase();
  const normalizedPrefix = (config.prefix ?? '').replace(/^\/+|\/+$/g, '');
  return `oss:${normalizedEndpoint}:${normalizedBucket}:${normalizedPrefix}`;
}

function normalizeDirectory(dir: string): string {
  const resolved = realpathSync(dir);  // 解软链，保证 ~/Pictures 和 /Users/x/Pictures 不重复
  return resolved.replace(/\/+$/, ''); // 去尾部斜杠
}
```

**为什么不含 AccessKey**：AccessKey 是凭证，会变更（轮换、过期），但数据集身份不应随之变化（D7 明确）。AccessKey 存 `credentials.json`。

## 4. 图片存储 adapter 抽象

### 4.1 ImageStore 接口

```ts
// companion/src/storage/imageStore.ts
export interface ImageStore {
  readonly kind: 'filesystem-default' | 'filesystem-custom' | 'oss';

  /** 保存图片。返回存储后用于引用的 blobKey（通常 = 入参 key）。 */
  save(key: string, data: Buffer, mimeType: string): Promise<{ size: number }>;

  /** 读取图片二进制。找不到返回 undefined。 */
  load(key: string): Promise<{ data: Buffer; mimeType: string } | undefined>;

  /** 删图片。key 不存在是 no-op。 */
  remove(key: string): Promise<void>;

  /** 统计当前 adapter 下的图片总字节（用于 estimateStoredBytes）。 */
  estimateBytes(): Promise<number>;
}
```

### 4.2 FileSystemImageStore（覆盖选项 A、B）

```ts
// companion/src/storage/fileSystemImageStore.ts
export function createFileSystemImageStore(opts: {
  rootDir: string;         // 选项 B = ~/.gpt-image-studio/images；选项 A = 用户指定目录
  opaqueNaming: boolean;   // 选项 B = true（文件名 = blobKey，无扩展名）；选项 A = false（文件名 = blobKey + 扩展名，可直接打开）
}): ImageStore { ... }
```

- **选项 B（默认二进制）**：`rootDir = ~/.gpt-image-studio/images`，`opaqueNaming = true`。文件名 = blobKey（无扩展名），用户不可直接识别。blobKey 仍是元数据里的唯一引用。
- **选项 A（指定目录）**：`rootDir = 用户目录`（绝对路径），`opaqueNaming = false`。文件名 = `${blobKey}.${ext}`（ext 从 mimeType 推导，如 `png`/`webp`/`jpg`），用户可用文件管理器直接打开。blobKey 与文件名的映射在 `save` 时确定并写回元数据。

**选项 A 的目录合法性校验**（解决未决问题「选项 A 目录合法性校验」）：
- 必须是绝对路径（拒绝相对路径，避免 Companion 的 cwd 漂移导致数据丢失）。
- 必须存在且可写（`accessSync(dir, W_OK)`），不存在则报错让用户先创建（不自动 mkdir，避免误创建到意外位置）。
- 拒绝系统敏感目录：`/`、`/etc`、`/usr`、`/bin`、`/System`、`/Windows`、`C:\Windows` 等（白名单思路：只允许用户目录下的路径，或显式黑名单）。
- 跨盘符：允许（用户可能想把图片存到外置盘），但需提示「跨盘符可能影响性能」。

### 4.3 OssImageStore（覆盖选项 C，仅阿里云 OSS）

```ts
// companion/src/storage/ossImageStore.ts
export function createOssImageStore(opts: {
  endpoint: string;
  bucket: string;
  prefix: string;          // 对象前缀，如 "gpt-image-studio/"
  accessKeyId: string;     // 从 credentials.json 读取
  accessKeySecret: string;
}): ImageStore { ... }
```

- 用阿里云 OSS SDK（`ali-oss`）上传/下载/删除。
- `save`：上传到 `${prefix}${blobKey}`，设置 `Content-Type`。
- `load`：getObject，返回 Buffer。
- `estimateBytes`：listObjects 遍历 prefix 下所有对象累加 size（可能较慢，可缓存）。
- **本机模式** AccessKey 存 `credentials.json`（与 provider 凭据同级别保护，0600，不进项目备份）。
- **服务器模式**（阶段三）改为 STS 临时凭证（D11），本阶段先实现长期 AccessKey 版本。

### 4.4 OSS 凭据录入流程（解决未决问题「OSS 凭据录入/存储/校验流程」）

- **录入入口**：Companion 管理页（`/admin`）新增「OSS 配置」区域，或在 Web 端设置页的「存储位置」选 C 时弹出 OSS 配置表单（前端只采集，通过 Companion 的 `/storage/oss-config` 路由写入 Companion 的 `credentials.json`，**不存前端**）。
- **存储位置**：`credentials.json` 新增 `oss` 字段：
  ```json
  {
    "entries": [...],         // 既有 provider 凭据
    "activeId": "...",
    "oss": {                  // 新增
      "endpoint": "oss-cn-hangzhou.aliyuncs.com",
      "bucket": "my-bucket",
      "accessKeyId": "...",
      "accessKeySecret": "...",
      "configuredAt": "2026-..."
    }
  }
  ```
- **连通性测试**：配置保存前，Companion 调 OSS `listObjects({ prefix: 'gpt-image-studio-connection-test', maxKeys: 1 })` 验证凭据有效，失败则拒绝保存并返回错误。
- **安全**：与 provider apiKey 同级别（明文 + 0600），不进项目备份，不回流 Web 端（Web 端只能写入和测试，不能读取）。

## 5. Companion 侧改造清单（PR 拆分依据）

| 模块 | 改造内容 | 新增/改动文件 |
|---|---|---|
| **依赖** | 新增 `better-sqlite3`（同步 SQLite）+ `ali-oss`（OSS SDK） | `companion/package.json`、根 `pnpm-workspace.yaml`（onlyBuiltDependencies） |
| **存储层** | 主 db + 业务 db 的打开/迁移/CRUD | `companion/src/storage/db.ts`（主 db）、`companion/src/storage/businessDb.ts`（业务 db）、`companion/src/storage/schema.ts`（DDL） |
| **图片 adapter** | FileSystemImageStore + OssImageStore + 接口 | `companion/src/storage/imageStore.ts`、`fileSystemImageStore.ts`、`ossImageStore.ts` |
| **数据集管理** | 配置指纹、去重、激活切换 | `companion/src/storage/datasetRegistry.ts`、`fingerprint.ts` |
| **存储路由** | `/storage/*` 提供 7 张表 CRUD + 图片二进制 + 配置 + 数据集管理 | `companion/src/routes/storage.ts` |
| **类型** | 存储请求/响应契约 | `companion/src/types.ts`（扩展）、`companion/src/storage/types.ts`（新增） |
| **测试** | 存储层单测 + 路由集成测试 | `companion/src/storage/*.test.ts`、`companion/src/routes/storage.test.ts` |
| **错误边界** | `StorageStoreError` + 复用 storeRouteWrapper 模式 | `companion/src/storage/errors.ts` |

## 6. 前端改造清单

| 模块 | 改造内容 |
|---|---|
| `src/services/storage/CompanionStorage.ts` | 骨架替换为 fetch 调用 `${companionUrl}/storage/*` |
| `src/services/storage/CompanionStorage.test.ts` | 接入契约测试套件 `runStudioStorageContractTests` |
| `src/services/storage/resolveStorage.ts` | `connectionMode === 'localCompanion'` 时返回 `CompanionStorage` |
| `src/stores/settingsStore.ts` | 新增 `storageLocation` 设置项（A/B/C 三选一），watch 切换时触发整套 reload |
| `src/app/studio/useStudioViewModel.ts` | `watch(connectionMode)` + `watch(storageLocation)` 监听切换，触发 hydrate reload |
| `src/features/settings/*` | 设置页新增「存储位置」配置区（选 A/B/C + 目录选择 + OSS 凭据录入） |
| 顶栏 UI | Companion 模式下显示「Companion 文件系统 / Companion OSS」状态徽标 |

## 7. PR 拆分（阶段二）

> 沿用阶段一的 PR 拆分哲学：每个 PR 独立可合并、typecheck/test 全绿、可独立回滚。

| PR | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **PR1** | Companion 侧 SQLite 基础设施：依赖引入（better-sqlite3 + onlyBuiltDependencies）、主 db + 业务 db 打开/迁移、7 张业务表 schema、CRUD 函数式 API、存储层单测 | 无 | 低（纯新增，不影响现有 routes） |
| **PR2** | Companion 侧图片 adapter：ImageStore 接口 + FileSystemImageStore（选项 A/B）+ 单测 | PR1 | 低（纯新增） |
| **PR3** | Companion 侧数据集管理：datasetRegistry + fingerprint + 激活切换逻辑 + 单测 | PR1 | 低（纯新增） |
| **PR4** | Companion 侧 `/storage/*` 路由：7 表 CRUD + 图片二进制 multipart + 配置 + 数据集查询/切换；集成测试 | PR1-3 | 中（新路由，需仔细测鉴权） |
| **PR5** | Companion 侧 OssImageStore（选项 C）+ OSS 凭据录入/连通性测试 + 单测 | PR2、PR4 | 中（引入 ali-oss 依赖，OSS 连通性测试需真实凭据或 mock） |
| **PR6** | 前端 CompanionStorage 填充：骨架替换为 fetch + 契约测试接入 + resolveStorage 切换逻辑 | PR4 | 中（首次让 Companion 模式真正工作，需端到端 smoke test） |
| **PR7** | 前端存储位置 UI：设置页 A/B/C 三选一 + 目录选择 + OSS 凭据录入 + 顶栏状态徽标 + 切换 reload 逻辑 | PR6 | 中（UI + ViewModel 切换逻辑） |
| **PR8** | 收尾：文档更新、README 补充部署说明、Companion 管理页增加存储位置管理入口 | PR1-7 | 低 |

**每个 PR 的验收门槛**：
- `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- `pnpm test` 全绿（含 companion 的测试）
- PR4、PR6、PR7 必须 manual smoke test（Companion 模式真实读写 SQLite）
- PR5 需验证 OSS 连通性测试在错误凭据下正确拒绝

## 8. 数据集隔离落地（D1 + D7 联合）

**前端切换流程**（以用户从 B 切到 A 指定 `/Users/x/Pics` 为例）：

1. 用户在设置页选「A. 指定目录」，输入 `/Users/x/Pics`，点确认。
2. 前端调 `POST ${companionUrl}/storage/datasets/activate`，body = `{ kind: 'filesystem-custom', directory: '/Users/x/Pics' }`。
3. Companion 计算指纹 `fs:/Users/x/Pics` → 查 `dataset_registry`。
   - 命中 → 拿到 `db_path`，UPDATE is_active。
   - 未命中 → INSERT registry 记录 + 新建空业务 db。
4. Companion 返回新的 datasetId。
5. 前端触发 `useStudioViewModel` 的 reload：清空内存状态 → 重新 hydrate（走 CompanionStorage 读新业务 db）。
6. 业务 db 是空的 → 前端看到空数据集。
7. 用户切回 B → 同样流程，找到 B 对应的业务 db → 原数据可见。

**切换前的确认提示**（UX）：
```
切换到 [A. 指定目录 /Users/x/Pics] 后，当前内容将不可见（不会删除），
新内容会存到新位置。切回 [B. 默认目录] 可找回原有内容。

是否继续？
```

## 9. 安全模型（阶段二本机模式）

| 维度 | 策略 |
|---|---|
| 监听 | 保持 `127.0.0.1:19750`（loopback），不对外 |
| 数据面鉴权 | `/storage/*` 走 bearer accessKey（与 `/images/*` 同级别） |
| 管理面鉴权 | `/storage/datasets/activate`、`/storage/oss-config` 走 loopbackGuard（与 `/credentials/*` 同级别） |
| 凭据存储 | provider 凭据 + OSS AccessKey 统一存 `credentials.json`（0600，明文，不进项目备份） |
| 日志脱敏 | 既有 redact 列表（authorization、apiKey、b64_json）保留，新增 `ossAccessKey`、`accessKeySecret` |
| 并发 | 本机单用户场景并发极低；SQLite 默认串行化写入，WAL 模式提升读并发。不引入应用层锁 |
| 配额 | 阶段二不强制配额（本机磁盘）。阶段三服务器模式再引入 |

## 10. 验收标准（沿用第七章 + 强化）

- ✅ Companion 模式下，所有 CRUD 操作真实落到 SQLite + 图片存储位置
- ✅ Companion 关闭/重启后，数据仍在（SQLite 文件持久化）
- ✅ direct ↔ Companion 切换后，看到的数据集正确隔离（IndexedDB 与 Companion SQLite 互相独立）
- ✅ A/B/C 存储位置切换后，看到的数据集正确隔离
- ✅ 切回原位置/原模式，原数据完整可见
- ✅ direct 模式行为不受影响（兼容性回归）
- ✅ OSS 模式下，图片真实上传到 OSS，本地只存引用
- ✅ **契约测试套件对 CompanionStorage 实现全绿**（复用阶段一的 `runStudioStorageContractTests`）
- ✅ **grep 确认 store/service 层无 Companion 直连**（全部走 StudioStorage 接口）：
  ```bash
  grep -rn "fetch.*companionUrl.*storage" src/stores/ src/services/ | grep -v "CompanionStorage.ts"
  ```
  应返回空（只有 CompanionStorage.ts 内部允许直连 fetch）
- ✅ Companion 后端的备份/恢复机制独立可用（提供 `/storage/export` + `/storage/import` 路由，不依赖前端 ZIP）

## 11. 本阶段不做

- ❌ 不上多用户/账号系统（阶段三）
- ❌ 不做 Companion 与 IndexedDB 的双向同步（D1 数据集隔离）
- ❌ 不做 A/B/C 之间的数据迁移（D1 数据集隔离）
- ❌ 不改 Companion 的技术栈（D3 沿用 Node/TS + Fastify）
- ❌ 不兼容非阿里云 OSS 的图床（D6）
- ❌ 不改监听地址（保持 127.0.0.1，服务器模式是阶段三）
- ❌ 不改鉴权模型（保持 accessKey + loopbackGuard，SSO 是阶段三）
- ❌ 不引入配额管理（阶段三）

## 12. 为后续阶段铺路

- Companion 已具备完整后端能力（存储 + provider 代理）→ 阶段三可平滑升级为服务器多用户服务
- D7 双层结构（主 db + 业务 db）→ 阶段三多租户隔离直接复用，业务 db schema 零改动（D9）
- 存储接口已验证可承载真实业务 → 阶段四的 NativeStorage 可照抄接口契约
- SQLite schema 已就位 → 阶段四 Tauri APP 直接复用同一份建表/迁移逻辑
- 图片存储 adapter 抽象（FileSystem / Oss）已就位 → 阶段四 APP 模式下可复用 FileSystem adapter

---

## 附录 A：Companion 现状探查详细结论（2026-07-27）

### A.1 目录结构

```
companion/
├── package.json          # @honlnk/image-studio-companion@0.6.1, ESM, type:"module"
├── tsconfig.json         # NodeNext, strict
└── src/
    ├── main.ts           # CLI 入口（commander），serve/start/stop/restart/logs/status/provider
    ├── server.ts         # Fastify 创建/启动，插件注册顺序敏感
    ├── types.ts          # 对外契约类型（健康/认证/凭据/日志响应）
    ├── accessKey.ts      # 连接密钥 access-key.json（0600）
    ├── credentials.ts    # provider 凭据 credentials.json（0600）★
    ├── securityConfig.ts # CORS/channel/body 限制配置工厂
    ├── processManager.ts # 后台进程管理（PID + 日志轮转）
    ├── providerPresets.ts
    ├── admin/            # 原生三件套管理页
    ├── middleware/
    │   ├── auth.ts       # bearer token 全局守卫
    │   └── loopback.ts   # 本机/白名单来源守卫
    ├── routes/
    │   ├── auth.ts       # GET /auth/status
    │   ├── credentials.ts # /credentials/* CRUD
    │   ├── images.ts     # POST /images/generations, /images/edits
    │   ├── logs.ts       # GET /logs/tail
    │   ├── admin.ts      # /admin/api/* + 静态托管
    │   └── storeRouteWrapper.ts
    ├── providers/        # 9 个 provider adapter + registry + profiles
    └── shared/knownFields.ts
```

### A.2 现有持久化文件（全部在 `~/.gpt-image-studio/`）

| 文件 | 写入方 | 内容 | 模式 |
|---|---|---|---|
| `credentials.json` | `credentials.ts` | provider 凭据 entries + activeId | 全文件读-改-写，0600 |
| `access-key.json` | `accessKey.ts` | 连接密钥 UUID | 启动读入内存，reset 时重写，0600 |
| `companion.pid` | `processManager.ts` | 后台进程元信息 | 0600 |
| `logs/companion-*.log` | processManager + Fastify logger | 运行日志 | append，7 天轮转 |
| `credentials.json.corrupt-{ts}.json` | `credentials.ts:backupCorruptFile` | 损坏备份 | 手动清理 |

### A.3 关键代码模式（阶段二要沿用）

1. **模块级常量 + 函数式导出**（无类、无 DI）：
   ```ts
   // credentials.ts 范式
   const CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");
   const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
   export function loadStore(): CredentialsStore { ... }
   export function saveStore(store) { ... }
   ```
   SQLite store 照搬：`const DB_DIR = ...; export function openBusinessDb(id) { ... }`。

2. **同步 I/O**：全用 `writeFileSync`/`readFileSync`，better-sqlite3 也是同步，风格一致。

3. **测试隔离**：`mkdtempSync` 建临时目录 → `process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir` → `vi.resetModules()` → 动态 import。SQLite 测试把 db 文件放进 tempDir 即可。

4. **错误边界**：`CredentialStoreError(code)` + `storeRouteWrapper.handleStoreError` 转 500。新存储层定义 `StorageStoreError(code)`，复用同一 wrapper。

5. **鉴权双轨**：loopbackGuard（`/credentials`、`/admin`）vs bearer accessKey（其余受保护路由）。新 `/storage/*` 数据面走 bearer，`/storage/datasets/activate`、`/storage/oss-config` 管理面走 loopbackGuard。

### A.4 依赖注意事项

- `better-sqlite3` 是原生模块（node-gyp 编译），加入 `companion/package.json` dependencies 后，**必须同时把 `better-sqlite3` 加进根 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`**（当前只有 `esbuild`），否则 pnpm 拒绝执行安装脚本。
- `ali-oss` 是纯 JS，无原生编译，正常加入即可。
- ESM + NodeNext：`import Database from "better-sqlite3"` 在 strict ESM 下可能需要 `.default` 互操作，参考现有 `createRequire` 范式（`main.ts:29`、`server.ts:15`）。
