# 阶段二 PR2：图片 adapter FileSystemImageStore（选项 A/B）

> **状态：🚧 进行中**
>
> 依赖：PR1（共用 storage 目录）
>
> 目标：实现图片存储 adapter 抽象 + FileSystemImageStore，覆盖选项 A（用户指定目录，可直接打开的图片）和选项 B（Companion 默认目录，不透明 Blob）。纯新增，不影响现有代码。

## 1. 改造范围

### 新增文件

```
companion/src/storage/
├── imageStore.ts              # ImageStore 接口 + 工厂函数
└── fileSystemImageStore.ts    # FileSystemImageStore 实现（选项 A/B）
```

### 不动的文件
- 所有现有 routes、credentials.ts、PR1 的 db.ts/businessDb.ts/schema.ts

## 2. 详细设计

### 2.1 ImageStore 接口（imageStore.ts）

```ts
export type SavedImage = { size: number; mimeType: string };
export type LoadedImage = { data: Buffer; mimeType: string };

export interface ImageStore {
  readonly kind: ImageStoreKind;  // 'filesystem-default' | 'filesystem-custom' | 'oss'

  /** 保存图片。返回字节大小（用于容量估算）。key 是 blobKey。 */
  save(key: string, data: Buffer, mimeType: string): Promise<SavedImage>;

  /** 读取图片。找不到返回 undefined。 */
  load(key: string): Promise<LoadedImage | undefined>;

  /** 删图片。key 不存在是 no-op。 */
  remove(key: string): Promise<void>;

  /** 统计当前 adapter 下的图片总字节。 */
  estimateBytes(): Promise<number>;
}
```

### 2.2 FileSystemImageStore（fileSystemImageStore.ts）

```ts
export function createFileSystemImageStore(opts: {
  rootDir: string;
  opaqueNaming: boolean;  // B=true（无扩展名）；A=false（带扩展名，可直开）
}): ImageStore
```

**文件命名策略**：
- 选项 B（opaqueNaming=true）：文件名 = `${blobKey}`（无扩展名）。元数据里 blobKey 即文件名。
- 选项 A（opaqueNaming=false）：文件名 = `${blobKey}.${ext}`，ext 从 mimeType 推导（`image/png`→`png`，`image/webp`→`webp`，`image/jpeg`→`jpg`）。元数据里 blobKey 不带 ext，load 时按 blobKey 找文件（glob 或记录映射）。

**实现要点**：
- `save`：`writeFileSync(join(rootDir, filename), data, { mode: 0o600 })`。
- `load`：读文件，mimeType 从... 选项 A 可从扩展名反推；选项 B 需要额外存储 mimeType（存 sidecar `.meta.json` 或在业务 db 的 imageBlobs 表记 mimeType）。**本 PR 决定：imageBlobs 表存 `{ key, size, mimeType, createdAt }` 元信息**（见 phase2-overview §3.2），load 时先查业务 db 拿 mimeType。但 ImageStore 接口本身不依赖业务 db——load 返回的 mimeType 由调用方（路由层）补全。
  - 简化：FileSystemImageStore.load 对选项 A 从扩展名推 mimeType；对选项 B 返回 `application/octet-stream`，路由层用业务 db 元信息覆盖。
- `remove`：`unlinkSync`，不存在 catch no-op。
- `estimateBytes`：`readdirSync(rootDir)` + `statSync` 累加 size。
- rootDir 不存在时 mkdir（recursive, 0700）。

**扩展名映射**：
```ts
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
};
const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([m, e]) => [e, m]),
);
```

### 2.3 选项 A 目录合法性校验（目录选择时调用，非 ImageStore 内部）

放 `fileSystemImageStore.ts` 导出独立函数 `validateCustomDirectory(dir)`：
- 必须绝对路径。
- 必须存在且可写（不自动创建，报错让用户先建）。
- 拒绝系统敏感目录黑名单。

## 3. 测试计划

`companion/src/storage/fileSystemImageStore.test.ts`：
- 选项 B：save/load/remove 往返一致，文件名无扩展名。
- 选项 A：save 文件名带扩展名，load 按 blobKey 找到文件并返回正确 mimeType。
- remove 不存在文件是 no-op。
- estimateBytes 累加正确，空目录返回 0。
- rootDir 不存在时首次 save 自动 mkdir。
- 非法 mimeType 降级处理（不抛错，用 fallback 扩展名或 octet-stream）。
- validateCustomDirectory：拒绝相对路径、拒绝不存在目录、拒绝系统目录、接受合法目录。

## 4. 验收门槛
- `pnpm typecheck:companion` + `pnpm test` 全绿
- 纯新增，现有功能不受影响
