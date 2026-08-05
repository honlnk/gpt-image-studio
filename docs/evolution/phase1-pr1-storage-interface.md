# 阶段一 PR1：StudioStorage 接口 + IndexedDbStorage 实现 + 契约测试骨架

> **状态**：✅ 已完成
> **依赖**：无（纯新增）
> **风险**：低（db.ts 并存，业务代码暂不切换，零行为变化）
> **纲领**：[`evolution-roadmap.md` §6.1, §6.5](../evolution-roadmap.md)

## 目标

建立 `StudioStorage` 抽象层的地基：

1. 定义 `StudioStorage` 接口（`src/services/storage/types.ts`）
2. 实现 `IndexedDbStorage`（搬迁现有 `db.ts` 逻辑）
3. 提供 `CompanionStorage` / `NativeStorage` 骨架（throw 未实现）
4. 提供运行时检测 `isTauriRuntime()` 和工厂 `resolveStorage()`（阶段一永远返回 IndexedDbStorage）
5. 引入测试基建（fake-indexeddb + happy-dom）
6. 建立契约测试套件骨架（参数化，30+ 用例）
7. **db.ts 保留并存**，业务代码暂不切换

## 改造清单（按文件）

### 新建文件

| 文件 | 内容 |
|---|---|
| `src/services/storage/types.ts` | `StudioStorage` 接口、`StorageBackend`、`StoreName`、`STORE_NAMES`（从 db.ts 迁出）、`ImageBlobRecord`、`StorageError` |
| `src/services/storage/IndexedDbStorage.ts` | `IndexedDbStorage` 类，搬迁 db.ts 的全部逻辑（DB_NAME/DB_VERSION/onupgradeneeded/replaceIndex/5 个 CRUD） |
| `src/services/storage/CompanionStorage.ts` | 骨架类，所有方法 throw `new StorageError("BACKEND_UNAVAILABLE", ...)` |
| `src/services/storage/NativeStorage.ts` | 骨架类，同上 |
| `src/services/storage/resolveStorage.ts` | `isTauriRuntime()` + `resolveStorage()`（阶段一恒返回 IndexedDbStorage） |
| `src/services/storage/index.ts` | barrel export |
| `src/services/storage/storage.contract.test.ts` | 参数化契约测试套件（`runStudioStorageContractTests`） |
| `src/services/storage/IndexedDbStorage.test.ts` | IndexedDbStorage 专项 + 调用契约套件 |
| `src/services/storage/InMemoryStorage.ts` | **测试用 mock 实现**（解决未决项：预埋 mock 验证"换实现不改接口"承诺） |
| `src/services/storage/InMemoryStorage.test.ts` | InMemoryStorage 调用契约套件 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/services/db.ts` | **不删不改**，与 IndexedDbStorage 并存。仅注释标注"阶段一 PR6 删除" |
| `package.json` | 加 devDependencies：`fake-indexeddb`、`happy-dom` |
| `vite.config.ts` | 不改全局 environment（避免影响现有 node 测试），用 per-file `// @vitest-environment happy-dom` |

## 接口设计（最终形态）

### 核心接口（`types.ts`）

```ts
export const STORE_NAMES = { ... } as const;  // 与 db.ts 现有定义一致
export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];
export type ImageBlobRecord = { key: string; blob: Blob };
export type StorageBackend = "indexeddb" | "companion" | "native";

export interface StudioStorage {
  readonly backend: StorageBackend;
  list<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  clear(store: StoreName): Promise<void>;
  saveImageBlob(key: string, blob: Blob): Promise<void>;
  loadImageBlob(key: string): Promise<Blob | undefined>;
  deleteImageBlob(key: string): Promise<void>;
  readConfig<T>(key: string): Promise<T | undefined>;
  writeConfig<T>(key: string, value: T): Promise<void>;
  estimateStoredBytes(): Promise<{ imageBytes: number; metadataBytes: number }>;
  estimateQuota?(): Promise<{ usage?: number; quota?: number }>;
}
```

### 错误模型

```ts
export class StorageError extends Error {
  readonly code: "KEY_NOT_FOUND" | "QUOTA_EXCEEDED" | "BACKEND_UNAVAILABLE" | "SERIALIZATION_ERROR" | "UNKNOWN";
  readonly cause?: unknown;
}
```

粗粒度 + code 字段（决策见 §6.1，未决项 PR1 review 时再定是否细化）。

### readConfig/writeConfig 的命名空间设计

阶段一：落到 settings 表，用保留前缀 `__config__:` 与业务 `app` 记录隔离。

```ts
// IndexedDbStorage 内部
private configKey(key: string) { return `__config__:${key}`; }
async readConfig<T>(key: string) {
  const record = await this.get<{ key: string; value: T }>(STORE_NAMES.settings, this.configKey(key));
  return record?.value;
}
```

**为什么不新建表**：新增 store 要改 DB_VERSION 触发 onupgradeneeded，PR1 想保持 schema 与现状完全一致。用前缀复用 settings 表是零风险方案。

### resolveStorage（阶段一形态）

```ts
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function resolveStorage(): StudioStorage {
  return new IndexedDbStorage();
  // 阶段二：connectionMode === "localCompanion" → CompanionStorage
  // 阶段四：isTauriRuntime() → NativeStorage
}
```

## 契约测试套件设计

### 参数化模式

```ts
// storage.contract.test.ts
export function runStudioStorageContractTests(
  name: string,
  createStorage: () => Promise<StudioStorage>,
  cleanup?: () => Promise<void>,
) {
  describe(`StudioStorage contract: ${name}`, () => {
    beforeEach(async () => { await cleanup?.(); });
    // ~30 用例，覆盖 §6.1 语义约束清单全部条目
  });
}
```

### 用例清单（30+）

**通用 CRUD（每条对 7 个 store 各跑一遍，或抽样覆盖）**：
1. list 空表返回 `[]`，不抛错
2. get 找不到返回 `undefined`，不抛错
3. put 是 upsert，同 key 反复 put 只留最后值
4. put 后 get 能取回（往返一致）
5. delete 不存在的 key 是 no-op，不抛错
6. delete 后 get 返回 undefined
7. clear 只清当前 collection，不影响其它
8. clear 后 list 返回 `[]`
9. list 返回顺序不保证（调用方自己排序）

**图片二进制**：
10. saveImageBlob / loadImageBlob 往返一致
11. loadImageBlob 找不到返回 undefined，不抛错
12. deleteImageBlob 不存在的 key 是 no-op
13. deleteImageBlob 后 loadImageBlob 返回 undefined
14. saveImageBlob 同 key 覆盖（upsert）

**配置**：
15. readConfig 找不到返回 undefined
16. writeConfig / readConfig 往返一致
17. writeConfig 同 key 覆盖
18. readConfig/writeConfig 与业务 settings 记录隔离（config key 不污染 `app` 记录）

**容量估算**：
19. estimateStoredBytes 空库返回 `{ imageBytes: 0, metadataBytes: 0 }`
20. estimateStoredBytes 存入数据后字节增长
21. estimateQuota 在 IndexedDbStorage 实现透传 navigator.storage.estimate（fake-indexeddb 下可能 undefined，用 typeof 守卫）

**错误语义**：
22. CompanionStorage 所有方法抛 `BACKEND_UNAVAILABLE`
23. NativeStorage 所有方法抛 `BACKEND_UNAVAILABLE`

**多记录**：
24. list 返回多条记录
25. 批量 put 后 list 数量正确
26. clear 不影响其它 store（跨 store 隔离验证）

**blob 边界**：
27. 空 blob（size=0）往返一致
28. 大 blob（1MB+）往返一致

**类型保持**：
29. put 复杂对象（嵌套、数组）往返结构一致
30. put 含 undefined 字段的对象行为定义（JSON 风格 vs 原样保持）

### IndexedDbStorage 专项（~15 用例）

- schema 升级 DB_VERSION 1→4（fake-indexeddb 模拟旧版本）
- 幂等建表（重复 open 不报错）
- 索引重命名（updatedAt→updatedAtMs 等迁移分支）
- 并发写（两个 put 同时进行）
- blob 大小边界（0 / 1MB / 10MB）
- 7 张表的 keyPath 正确性
- onupgradeneeded 触发条件

## 测试基建

### 引入依赖

```bash
pnpm add -D fake-indexeddb happy-dom
```

### vitest 配置策略

**不全局改 environment**（避免影响现有 node 环境测试，如 zipArchive.test.ts）。在 storage 相关测试文件顶部加注释：

```ts
// @vitest-environment happy-dom
```

happy-dom 提供 `URL.createObjectURL`、`indexedDB` 等浏览器 API；fake-indexeddb 通过 `globalThis.indexedDB = fakeIndexedDB` 注入。

### fake-indexeddb 行为差异缓解（§6.5）

- 契约测试**只断言语义**（list 后能 get 到、delete 后 list 为空），不断言 IndexedDB 特有时序/并发
- schema 迁移分支在 PR 合并前 **manual smoke test**（DevTools 验证）
- 关键路径（生成、备份恢复、草稿）各 PR **manual smoke test**

## 验收门槛

- ✅ `pnpm typecheck` 0 错误（新增文件类型完整）
- ✅ `pnpm test` 全绿（含新契约测试套件）
- ✅ 契约测试套件对 IndexedDbStorage + InMemoryStorage 两个实现全绿
- ✅ IndexedDbStorage 专项测试覆盖 schema 升级
- ✅ db.ts 未被修改（grep 确认并存）
- ✅ 业务代码未引用新 storage 模块（grep 确认 PR1 不触碰业务层）
- ✅ CompanionStorage / NativeStorage 骨架正确抛 BACKEND_UNAVAILABLE

## 回滚策略

纯新增 PR，回滚只需删除 `src/services/storage/` 目录和两个 devDependency。db.ts 完全不受影响，业务零影响。

## 未决项决策（PR1 落地时定）

1. **错误类型粒度**：暂用粗粒度 `StorageError` + code 字段。理由：实现成本低、调用方判错统一；细粒度子类留待真实需求出现。
2. **契约测试是否预埋 mock 实现**：✅ **决定预埋 `InMemoryStorage`**。理由：阶段一只有 IndexedDbStorage 一个真实实现，若无 mock，"换实现不改接口"的承诺完全无法验证。InMemoryStorage 成本极低（纯内存 Map），却能让契约套件从 PR1 起就跑在两个实现上，提前发现接口设计的不一致。
3. **readConfig/writeConfig 命名空间**：用 `__config__:` 前缀复用 settings 表，不新建 store。

## 实施记录

### 2026-07-27 实施完成

**新增文件**（10 个）：
- `src/services/storage/types.ts` — StudioStorage 接口、StorageError、STORE_NAMES、ImageBlobRecord、StorageBackend
- `src/services/storage/IndexedDbStorage.ts` — 真实实现，搬迁 db.ts 全部逻辑 + 新增 blob/config/estimate 能力
- `src/services/storage/CompanionStorage.ts` — 骨架（阶段二填充）
- `src/services/storage/NativeStorage.ts` — 骨架（阶段四填充，暂不实施）
- `src/services/storage/InMemoryStorage.ts` — 测试用 mock 实现（解决未决项 2，预埋验证"换实现不改接口"）
- `src/services/storage/resolveStorage.ts` — isTauriRuntime() + resolveStorage()（阶段一恒返回 IndexedDbStorage）
- `src/services/storage/index.ts` — barrel export
- `src/services/storage/storage.contract.test.ts` — 参数化契约套件（53 用例，覆盖 IndexedDbStorage + InMemoryStorage 两实现）
- `src/services/storage/IndexedDbStorage.test.ts` — IDB 专项（17 用例：schema、keyPath、索引迁移、并发写、容量估算）
- `src/services/storage/storage-skeletons.test.ts` — 骨架行为断言（27 用例：BACKEND_UNAVAILABLE + resolveStorage）

**修改文件**：
- `package.json` — 加 devDependencies：`fake-indexeddb@^6.2.5`、`happy-dom@^20.11.1`

**与计划的偏差**：
1. **happy-dom 未实际启用**。原计划用 `// @vitest-environment happy-dom`，实测发现 happy-dom 的 Blob 不支持 structuredClone，fake-indexeddb 序列化时把 Blob 降级成普通对象（丢失 size/type）。改用默认 node 环境 + fake-indexeddb，Node 原生 Blob 完美支持 structuredClone。happy-dom 依赖保留（未来 feature 层测试可能需要 DOM API），但 storage 测试不用。文档 §6.5 的"fake-indexeddb 行为差异风险"补一条：**happy-dom Blob 与 structuredClone 不兼容**。
2. **未决项 2 决策**：✅ 预埋 InMemoryStorage。理由如计划所述，成本极低但让契约套件从 PR1 起跑在两实现上。
3. **InMemoryStorage 的 config 实现对齐 IndexedDbStorage**：原设计用独立 Map，后改为走 settings 表 `__config__:` 前缀，与 IndexedDbStorage 完全一致——否则契约套件的"settings 表条目数"断言对两实现语义不一致，失去"换实现不改接口"的验证意义。

**验收结果**：
- ✅ `pnpm typecheck` 0 错误
- ✅ `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（756 用例，含新增 97 个 storage 测试）
- ✅ db.ts 未修改（git diff 为空）
- ✅ 业务代码未引用新 storage 模块
- ✅ 契约套件对 IndexedDbStorage + InMemoryStorage 两实现全绿（53 用例 × 2 = 实际跑 53 套，含共用断言）
- ✅ IndexedDbStorage 专项覆盖 schema 升级、keyPath、索引迁移（17 用例）
- ✅ CompanionStorage / NativeStorage 骨架正确抛 BACKEND_UNAVAILABLE
