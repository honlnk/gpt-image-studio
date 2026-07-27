/**
 * SQLite schema 定义（主 db + 业务 db）。
 *
 * 设计原则（evolution-roadmap.md §3.2 phase2-overview.md）：
 * - 业务表镜像 IndexedDB 的 keyPath + value 模型，每张表 = key + value(JSON)。
 *   理由：StudioStorage.put(value) 是 upsert 整个对象，业务对象字段会随演进变化，
 *   拆成关系列会让 schema 迁移成为常态；保持 key+value 让迁移路径最短。
 * - 表名与前端 STORE_NAMES（src/services/storage/types.ts）严格对齐。
 * - schema 版本用 PRAGMA user_version 管理。
 */

/** 主 db schema 版本。dataset_registry 结构变更时递增。 */
export const MASTER_DB_VERSION = 2;

/** 业务 db schema 版本。7 表结构变更时递增。 */
export const BUSINESS_DB_VERSION = 1;

/**
 * 主 db 的 DDL（D7 主 db 层，v2 含 users 表 + user_id 外键）。
 *
 * v2 变更（阶段三 PR2 多租户）：
 * - 新增 users 表（本地数据归属索引，不存密码）。
 * - dataset_registry 加 user_id 列（默认 '__local__'，local 模式虚拟用户）。
 * - fingerprint 唯一性改为 (user_id, fingerprint) 复合——不同用户可有相同配置。
 *
 * 旧库（v1）通过 MASTER_DB_MIGRATION_V2 升级，不直接用此 DDL。
 */
export const MASTER_DB_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dataset_registry (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT '__local__',
    label            TEXT NOT NULL,
    storage_kind     TEXT NOT NULL,
    storage_config   TEXT NOT NULL,
    fingerprint      TEXT NOT NULL,
    db_path          TEXT NOT NULL,
    image_store_kind TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    activated_at     TEXT NOT NULL,
    is_active        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_registry_active ON dataset_registry(is_active);
  CREATE INDEX IF NOT EXISTS idx_registry_user ON dataset_registry(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_user_fingerprint ON dataset_registry(user_id, fingerprint);
`;

/**
 * v1 → v2 迁移 DDL（阶段三 PR2）。
 *
 * 旧库已有 dataset_registry（v1 schema，fingerprint 全局 UNIQUE），需：
 * 1. 建 users 表。
 * 2. 给 dataset_registry 加 user_id 列（默认 '__local__'，已有数据全部归到本地虚拟用户）。
 * 3. 删除旧的 idx_registry_fingerprint（全局唯一），建 (user_id, fingerprint) 复合唯一索引。
 *
 * 注意：SQLite 的 ALTER TABLE ADD COLUMN 加 NOT NULL DEFAULT 是安全的（已有行填默认值）。
 * 索引重建用 DROP INDEX + CREATE INDEX（SQLite 不支持 CREATE INDEX IF NOT EXISTS 改定义）。
 */
export const MASTER_DB_MIGRATION_V2 = `
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
  );

  -- 加 user_id 列（幂等：用 try/catch 包裹，列已存在时 better-sqlite3 抛错被 db.ts 忽略）
  -- 注意：SQLite 不支持 ADD COLUMN IF NOT EXISTS，这里只产出 ALTER 语句，由 db.ts 的迁移
  -- 逻辑负责幂等处理（catch "duplicate column" 错误）。

  DROP INDEX IF EXISTS idx_registry_fingerprint;
  CREATE INDEX IF NOT EXISTS idx_registry_user ON dataset_registry(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_user_fingerprint ON dataset_registry(user_id, fingerprint);
`;

/**
 * v1→v2 迁移时给 dataset_registry 加 user_id 列的单条 ALTER（独立执行以便幂等 catch）。
 */
export const MASTER_DB_MIGRATION_V2_ADD_USER_ID = `
  ALTER TABLE dataset_registry ADD COLUMN user_id TEXT NOT NULL DEFAULT '__local__'
`;

/**
 * 业务 db 的 7 张表 DDL（D7 业务 db 层）。
 * 每张表结构一致：key (TEXT PRIMARY KEY) + value (TEXT, JSON)。
 * keyPath 映射见 BUSINESS_DB_KEY_PATHS 注释。
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

/**
 * 业务表的合法表名（与前端 STORE_NAMES 对齐）。
 *
 * keyPath 映射（与 IndexedDbStorage 的 DB schema 一致）：
 * - conversations:      conversation.id
 * - messages:           message.id
 * - imageAssets:        imageAsset.id
 * - imageBlobs:         imageBlobRecord.key（选项 B 存元信息；A/C 模式为空）
 * - settings:           settings 单记录（固定 key "__app_settings__"）+ config 命名空间（"__config__:" 前缀）
 * - conversationDrafts: draft.conversationId
 * - analyticsEvents:    event.id
 */
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

/**
 * 校验表名是否合法。防 SQL 注入——所有 SQL 都用参数化 key/value，
 * 但表名无法参数化，必须用白名单校验后才能拼进 SQL 字符串。
 */
export function isBusinessTable(name: string): name is BusinessTable {
  return (BUSINESS_TABLES as readonly string[]).includes(name);
}
