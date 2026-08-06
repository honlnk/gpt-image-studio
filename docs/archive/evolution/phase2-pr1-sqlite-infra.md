# 阶段二 PR1：Companion 侧 SQLite 基础设施

> **状态：✅ 已完成（2026-07-27）**
>
> 依赖：无（阶段二第一个 PR）
>
> 目标：为 Companion 引入 SQLite 存储能力，建立主 db + 业务 db 双层结构（D7），提供 7 张业务表的 CRUD 函数式 API。本 PR 纯新增，不影响现有 routes，不改变 Companion 运行时行为。

## 1. 改造范围

### 1.1 依赖引入

**`companion/package.json`** 新增依赖：
```jsonc
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"   // 同步 SQLite，与现有同步 I/O 风格一致
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

**根 `pnpm-workspace.yaml`** 的 `onlyBuiltDependencies` 追加 `better-sqlite3`（原生模块需 node-gyp 编译，pnpm 默认拒绝执行 install 脚本）：
```yaml
onlyBuiltDependencies:
  - esbuild
  - better-sqlite3
```

### 1.2 新增文件结构

```
companion/src/storage/
├── db.ts                 # 主 db（studio.db）打开 + dataset_registry schema + CRUD
├── businessDb.ts         # 业务 db 打开/缓存 + 7 表 schema + CRUD
├── schema.ts             # DDL 常量（主 db + 业务 db）
├── errors.ts             # StorageStoreError（复用 storeRouteWrapper 模式）
└── types.ts              # 存储相关 TS 类型（DatasetRecord、StorageConfig 等）
```

### 1.3 不动的文件

- 所有现有 routes（`credentials.ts`、`images.ts`、`auth.ts`、`logs.ts`、`admin.ts`）
- `credentials.ts`、`accessKey.ts`、`processManager.ts`（provider 凭据/连接密钥/进程管理保持不变）
- `server.ts`（本 PR 不注册新路由）
- 前端任何文件

## 2. 详细设计

### 2.1 schema.ts —— DDL 定义

```ts
// companion/src/storage/schema.ts

/** 主 db 版本。schema 变更时递增，在 openMasterDb 内按 version 迁移。 */
export const MASTER_DB_VERSION = 1;

/** 业务 db 版本。7 表 schema 变更时递增。 */
export const BUSINESS_DB_VERSION = 1;

/** 主 db 的 dataset_registry 表 DDL。 */
export const MASTER_DB_DDL = `
  CREATE TABLE IF NOT EXISTS dataset_registry (
    id               TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    storage_kind     TEXT NOT NULL,        -- 'filesystem' | 'oss'
    storage_config   TEXT NOT NULL,        -- JSON
    fingerprint      TEXT NOT NULL UNIQUE,
    db_path          TEXT NOT NULL,
    image_store_kind TEXT NOT NULL,        -- 'filesystem-default' | 'filesystem-custom' | 'oss'
    created_at       TEXT NOT NULL,
    activated_at     TEXT NOT NULL,
    is_active        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_registry_active ON dataset_registry(is_active);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_fingerprint ON dataset_registry(fingerprint);
`;

/**
 * 业务 db 的 7 张表 DDL。
 * 设计：每张表 = key + value(JSON)，镜像 IndexedDB 的 keyPath + value 模型。
 * keyPath 见 BUSINESS_DB_KEY_PATHS。
 */
export const BUSINESS_DB_DDL = `
  CREATE TABLE IF NOT EXISTS conversations      (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages           (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS imageAssets        (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS imageBlobs         (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings           (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversationDrafts (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analyticsEvents    (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** 业务表的合法表名（与前端 STORE_NAMES 对齐）。 */
export const BUSINESS_TABLES = [
  "conversations",
  "messages",
  "imageAssets",
  "imageBlobs",
  "settings",
  "conversationDrafts",
  "analyticsEvents",
] as const;

export type BusinessTable = (typeof BUSINESS_TABLES)[number];

/** 校验表名是否合法（防 SQL 注入，路由层用）。 */
export function isBusinessTable(name: string): name is BusinessTable {
  return (BUSINESS_TABLES as readonly string[]).includes(name);
}
```

### 2.2 errors.ts —— 错误类型

```ts
// companion/src/storage/errors.ts

export type StorageErrorCode =
  | "STORAGE_INVALID_TABLE"     // 路由传入非法表名
  | "STORAGE_INVALID_KEY"       // key 不合法（空、类型错）
  | "STORAGE_SERIALIZATION"     // JSON 序列化/反序列化失败
  | "STORAGE_DB_OPEN"           // db 文件打开失败（权限、损坏）
  | "STORAGE_DATASET_NOT_FOUND" // 数据集不存在
  | "STORAGE_FINGERPRINT_CONFLICT" // 指纹冲突（理论不应发生，UNIQUE 约束兜底）
  | "STORAGE_UNKNOWN";

export class StorageStoreError extends Error {
  readonly code: StorageErrorCode;
  constructor(message: string, code: StorageErrorCode, options: { cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StorageStoreError";
    this.code = code;
  }
}
```

### 2.3 db.ts —— 主 db（dataset_registry CRUD）

```ts
// companion/src/storage/db.ts
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { MASTER_DB_DDL, MASTER_DB_VERSION } from "./schema.js";
import type { DatasetRecord } from "./types.js";

const CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR
  ?? join(homedir(), ".gpt-image-studio");
const DATASETS_DIR = join(CONFIG_DIR, "datasets");

let masterDb: Database.Database | null = null;

/** 打开主 db（单例，进程内缓存）。首次打开时建表 + 设版本。 */
export function openMasterDb(): Database.Database {
  if (masterDb) return masterDb;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(DATASETS_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(join(CONFIG_DIR, "studio.db"), { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MASTER_DB_DDL);
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current < MASTER_DB_VERSION) {
    db.pragma(`user_version = ${MASTER_DB_VERSION}`);
  }
  masterDb = db;
  return db;
}

/** 关闭主 db（测试用）。 */
export function closeMasterDb(): void {
  masterDb?.close();
  masterDb = null;
}

// ─── dataset_registry CRUD ───

export function insertDataset(record: DatasetRecord): void {
  const db = openMasterDb();
  db.prepare(`
    INSERT INTO dataset_registry
      (id, label, storage_kind, storage_config, fingerprint, db_path,
       image_store_kind, created_at, activated_at, is_active)
    VALUES (@id, @label, @storage_kind, @storage_config, @fingerprint, @db_path,
            @image_store_kind, @created_at, @activated_at, @is_active)
  `).run(record);
}

export function findDatasetByFingerprint(fingerprint: string): DatasetRecord | undefined {
  return openMasterDb().prepare(
    "SELECT * FROM dataset_registry WHERE fingerprint = ?"
  ).get(fingerprint) as DatasetRecord | undefined;
}

export function getActiveDataset(): DatasetRecord | undefined {
  return openMasterDb().prepare(
    "SELECT * FROM dataset_registry WHERE is_active = 1 ORDER BY activated_at DESC LIMIT 1"
  ).get() as DatasetRecord | undefined;
}

export function getDataset(id: string): DatasetRecord | undefined {
  return openMasterDb().prepare(
    "SELECT * FROM dataset_registry WHERE id = ?"
  ).get(id) as DatasetRecord | undefined;
}

export function listDatasets(): DatasetRecord[] {
  return openMasterDb().prepare(
    "SELECT * FROM dataset_registry ORDER BY activated_at DESC"
  ).all() as DatasetRecord[];
}

/** 激活某数据集（先全置 0，再置目标为 1，事务保证原子）。 */
export function activateDataset(id: string, now: string): void {
  const db = openMasterDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE dataset_registry SET is_active = 0").run();
    db.prepare(
      "UPDATE dataset_registry SET is_active = 1, activated_at = ? WHERE id = ?"
    ).run(now, id);
  });
  tx();
}

export function deleteDataset(id: string): void {
  openMasterDb().prepare("DELETE FROM dataset_registry WHERE id = ?").run(id);
}

export function renameDataset(id: string, label: string): void {
  openMasterDb().prepare(
    "UPDATE dataset_registry SET label = ? WHERE id = ?"
  ).run(label, id);
}

export { DATASETS_DIR };
```

### 2.4 businessDb.ts —— 业务 db（7 表 CRUD）

```ts
// companion/src/storage/businessDb.ts
import Database from "better-sqlite3";
import { BUSINESS_DB_DDL, BUSINESS_DB_VERSION, BUSINESS_TABLES, isBusinessTable } from "./schema.js";
import { StorageStoreError } from "./errors.js";

const dbCache = new Map<string, Database.Database>();

/** 打开某数据集的业务 db（按 dbPath 缓存）。首次打开建表 + 设版本。 */
export function openBusinessDb(dbPath: string): Database.Database {
  const cached = dbCache.get(dbPath);
  if (cached) return cached;
  const db = new Database(dbPath, { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.exec(BUSINESS_DB_DDL);
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current < BUSINESS_DB_VERSION) {
    db.pragma(`user_version = ${BUSINESS_DB_VERSION}`);
  }
  dbCache.set(dbPath, db);
  return db;
}

/** 关闭所有缓存的业务 db（测试用）。 */
export function closeAllBusinessDbs(): void {
  for (const db of dbCache.values()) db.close();
  dbCache.clear();
}

// ─── 7 表 CRUD（函数式，与前端 StudioStorage 语义对齐） ───

export function listTable(dbPath: string, table: string): unknown[] {
  assertTable(table);
  const db = openBusinessDb(dbPath);
  const rows = db.prepare(`SELECT value FROM ${table}`).all() as { value: string }[];
  return rows.map((r) => JSON.parse(r.value));
}

export function getRecord(dbPath: string, table: string, key: string): unknown | undefined {
  assertTable(table);
  const db = openBusinessDb(dbPath);
  const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : undefined;
}

export function putRecord(dbPath: string, table: string, key: string, value: unknown): void {
  assertTable(table);
  const db = openBusinessDb(dbPath);
  const serialized = JSON.stringify(value);
  db.prepare(
    `INSERT INTO ${table} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, serialized);
}

export function deleteRecord(dbPath: string, table: string, key: string): void {
  assertTable(table);
  openBusinessDb(dbPath).prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
}

export function clearTable(dbPath: string, table: string): void {
  assertTable(table);
  openBusinessDb(dbPath).prepare(`DELETE FROM ${table}`).run();
}

function assertTable(table: string): asserts table is BusinessTable {
  if (!isBusinessTable(table)) {
    throw new StorageStoreError("STORAGE_INVALID_TABLE", `Unknown table: ${table}`);
  }
}

export { BUSINESS_TABLES };
```

### 2.5 types.ts —— 存储类型

```ts
// companion/src/storage/types.ts

export type StorageKind = "filesystem" | "oss";
export type ImageStoreKind = "filesystem-default" | "filesystem-custom" | "oss";

export type FilesystemConfig = {
  directory: string;          // 绝对路径
};

export type OssConfig = {
  endpoint: string;
  bucket: string;
  prefix: string;
};

export type StorageConfig = FilesystemConfig | OssConfig;

export type DatasetRecord = {
  id: string;
  label: string;
  storage_kind: StorageKind;
  storage_config: string;       // JSON.stringify(StorageConfig)
  fingerprint: string;
  db_path: string;              // 业务 db 绝对路径
  image_store_kind: ImageStoreKind;
  created_at: string;           // ISO
  activated_at: string;         // ISO
  is_active: 0 | 1;
};

/** 查询/返回时把 is_active 数字转 boolean 的视图类型。 */
export type DatasetView = Omit<DatasetRecord, "is_active"> & { is_active: boolean };
```

## 3. 测试计划

### 3.1 新增测试文件

| 文件 | 覆盖 |
|---|---|
| `companion/src/storage/db.test.ts` | 主 db 打开/建表/版本、dataset_registry CRUD（insert/find/get/list/activate/delete/rename）、activate 事务原子性 |
| `companion/src/storage/businessDb.test.ts` | 业务 db 打开/建表/版本、7 表 CRUD（list/get/put/delete/clear）、put 的 upsert 语义、非法表名抛错、db 缓存命中 |
| `companion/src/storage/schema.test.ts` | isBusinessTable 校验、DDL 字符串包含必要表 |

### 3.2 测试隔离模式（沿用项目惯例）

```ts
// 每个测试文件 beforeEach
beforeEach(() => {
  const tmpDir = mkdtempSync(join(tmpdir(), "companion-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  closeMasterDb();      // 关主 db 连接
  closeAllBusinessDbs(); // 关业务 db 连接
  deleteSync(tmpDir, { recursive: true, force: true });
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
});
```

### 3.3 关键用例

- `openMasterDb()` 首次调用创建 studio.db + datasets/ 目录，权限 0700。
- `openMasterDb()` 二次调用返回同一实例（缓存）。
- `insertDataset` + `findDatasetByFingerprint` 往返一致。
- `findDatasetByFingerprint` 对不存在的指纹返回 undefined。
- `activateDataset` 在事务内执行：激活 B 后 A 的 is_active=0，B 的 is_active=1 + activated_at 更新。
- `activateDataset` 对不存在的 id 不报错（UPDATE 0 行，符合 SQL 语义）。
- `listTable` 空表返回 `[]`。
- `getRecord` 不存在的 key 返回 undefined。
- `putRecord` 同 key 反复 put 只保留最后值（upsert）。
- `deleteRecord` 不存在的 key 是 no-op。
- `clearTable` 只清当前表，不影响其它表。
- `putRecord` + `assertTable` 对非法表名抛 `STORAGE_INVALID_TABLE`。
- `putRecord` 对循环引用对象抛 `STORAGE_SERIALIZATION`（JSON.stringify 失败时捕获）。

## 4. 验收门槛

- ✅ `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（含新增 storage 测试）
- ✅ `better-sqlite3` 正确安装（pnpm-workspace.yaml 配置后）
- ✅ 主 db + 业务 db 文件正确创建在 `~/.gpt-image-studio/`（测试中验证 tempDir 下结构）
- ✅ 现有 Companion 功能不受影响（`pnpm dev:companion` 正常启动，现有 routes 测试全绿）

## 5. 回滚策略

- 本 PR 纯新增（只加 `companion/src/storage/` 目录 + 依赖），不改任何现有文件。
- 回滚 = 删除 `companion/src/storage/` 目录 + 移除 `better-sqlite3` 依赖 + 还原 pnpm-workspace.yaml。
- 零运行时影响（新代码未被任何 route 调用）。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| `better-sqlite3` 原生编译失败（Node 版本/arm64） | 加 onlyBuiltDependencies 后 pnpm 会跑编译；若失败，检查 Node ≥20 + Xcode CLT |
| ESM 下 `import Database from "better-sqlite3"` 的 `.default` 互操作 | 若默认导入失败，改用 `createRequire` 范式（参考 main.ts:29） |
| SQLite WAL 模式在测试清理时残留 `-wal`/`-shm` 文件 | close db 连接后再删 tempDir，或用 `file::memory:` 做纯内存测试（但本 PR 要验证文件创建，用真实文件） |
