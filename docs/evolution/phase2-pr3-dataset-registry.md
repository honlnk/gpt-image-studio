# 阶段二 PR3：数据集管理（datasetRegistry + fingerprint + 激活切换）

> **状态：🚧 进行中**
>
> 依赖：PR1（主 db CRUD）+ PR2（ImageStore）
>
> 目标：实现数据集的业务编排层——配置指纹计算、按指纹去重创建/复用数据集、激活切换、为数据集装配对应的 ImageStore。这是连接「存储位置配置」和「底层存储实现」的中间层，PR4 的路由层会调用它。

## 1. 改造范围

### 新增文件

```
companion/src/storage/
├── fingerprint.ts         # 配置指纹计算 + 目录归一化
└── datasetRegistry.ts     # 数据集业务编排（resolveOrCreate / activate / getImageStore）
```

### 不动的文件
- PR1/PR2 的所有文件、现有 routes

## 2. 详细设计

### 2.1 fingerprint.ts —— 配置指纹

```ts
import { realpathSync } from "node:fs";

/** 计算配置指纹（D7 配置去重）。 */
export function computeFingerprint(
  kind: "filesystem" | "oss",
  config: FilesystemConfig | OssConfig,
): string {
  if (kind === "filesystem") {
    return `fs:${normalizeDirectory(config.directory)}`;
  }
  // oss：endpoint + bucket + prefix，不含 AccessKey
  const endpoint = config.endpoint.replace(/\/+$/, "").toLowerCase();
  const bucket = config.bucket.toLowerCase();
  const prefix = (config.prefix ?? "").replace(/^\/+|\/+$/g, "");
  return `oss:${endpoint}:${bucket}:${prefix}`;
}

/** 归一化目录路径：realpathSync 解软链 + 去尾斜杠。 */
export function normalizeDirectory(dir: string): string {
  const resolved = realpathSync(dir);  // 解软链，~/Pictures = /Users/x/Pictures
  return resolved.replace(/[\\/]+$/, ""); // 去尾斜杠
}
```

### 2.2 datasetRegistry.ts —— 业务编排

核心函数：

```ts
/** 高层 API：根据存储位置配置，解析或创建数据集并激活。返回激活后的 dataset + imageStore。 */
export async function resolveAndActivate(input: {
  storageKind: "filesystem" | "oss";
  storageConfig: StorageConfig;
  imageStoreKind: ImageStoreKind;
  label?: string;
}): Promise<{ dataset: DatasetView; imageStore: ImageStore }>

/** 获取当前激活数据集的 ImageStore（路由层每次请求前调用）。 */
export async function getActiveImageStore(): Promise<{ dataset: DatasetView; imageStore: ImageStore } | undefined>

/** 列出全部数据集（视图类型，is_active 转 boolean）。 */
export function listDatasetViews(): DatasetView[]

/** 删除数据集（关业务 db 连接 + 删 db 文件 + 删 registry 记录）。 */
export async function deleteDatasetCascade(id: string): Promise<void>
```

**resolveAndActivate 流程**（D7 切换流程落地）：
1. `computeFingerprint(storageKind, storageConfig)` 算指纹。
2. `findDatasetByFingerprint(fingerprint)`：
   - 命中 → 复用，`activateDataset(id, now)`。
   - 未命中 → 建 registry 记录（id=uuid, db_path=datasets/<id>.db）+ 新空业务 db 自动由 openBusinessDb 创建 → `activateDataset`。
3. 根据 imageStoreKind 装配 ImageStore：
   - filesystem-default → createFileSystemImageStore({ rootDir: ~/.gpt-image-studio/images, opaqueNaming: true })
   - filesystem-custom → createFileSystemImageStore({ rootDir: config.directory, opaqueNaming: false })
   - oss → createOssImageStore(...)（PR5 实现，本 PR 先 throw not-implemented）
4. 返回 `{ dataset, imageStore }`。

**getActiveImageStore 流程**：
1. `getActiveDataset()` 查主 db。
2. 无 active → 返回 undefined（首次启动场景，路由层据此引导用户初始化默认数据集）。
3. 有 active → 解析 storage_config，按 image_store_kind 装配 ImageStore 返回。

### 2.3 首次启动默认数据集初始化

Companion 启动时（server.ts）调用 `ensureDefaultDataset()`：
- 查 active dataset。
- 无 → 自动创建选项 B 默认数据集（`~/.gpt-image-studio/images`，opaqueNaming）。
- 有 → no-op。

这样 Companion 首次启动就有一个可用的默认数据集，前端切到 Companion 模式立即能用，无需用户先配置存储位置。

## 3. 测试计划

`companion/src/storage/fingerprint.test.ts`：
- filesystem 指纹格式 `fs:<normalized>`。
- realpathSync 解软链（用 symlink 测试）。
- 去尾斜杠。
- oss 指纹格式 `oss:<endpoint>:<bucket>:<prefix>`。
- oss endpoint 去尾斜杠 + 小写化。
- oss prefix 去首尾斜杠。
- 同配置同指纹，不同配置不同指纹。

`companion/src/storage/datasetRegistry.test.ts`：
- resolveAndActivate 首次创建新数据集（registry 有记录 + 业务 db 文件存在）。
- resolveAndActivate 同配置复用（不新建，fingerprint 命中）。
- resolveAndActivate 激活后 is_active=1，旧 active 置 0。
- getActiveImageStore 无 active 返回 undefined。
- getActiveImageStore 有 active 返回对应 imageStore。
- filesystem-default 装配的 imageStore.kind = 'filesystem-default'。
- filesystem-custom 装配的 imageStore.kind = 'filesystem-custom'。
- listDatasetViews is_active 转 boolean。
- deleteDatasetCascade 删 db 文件 + registry 记录。
- ensureDefaultDataset 首次创建默认数据集，二次 no-op。

## 4. 验收门槛
- `pnpm typecheck:companion` + `pnpm test` 全绿
- 纯新增
