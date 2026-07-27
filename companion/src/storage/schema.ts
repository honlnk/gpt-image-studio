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
export const MASTER_DB_VERSION = 1;

/** 业务 db schema 版本。7 表结构变更时递增。 */
export const BUSINESS_DB_VERSION = 1;

/**
 * 主 db 的 dataset_registry 表 DDL（D7 主 db 层）。
 * 详见 phase2-overview.md §3.3。
 */
export const MASTER_DB_DDL = `
  CREATE TABLE IF NOT EXISTS dataset_registry (
    id               TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    storage_kind     TEXT NOT NULL,
    storage_config   TEXT NOT NULL,
    fingerprint      TEXT NOT NULL UNIQUE,
    db_path          TEXT NOT NULL,
    image_store_kind TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    activated_at     TEXT NOT NULL,
    is_active        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_registry_active ON dataset_registry(is_active);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_fingerprint ON dataset_registry(fingerprint);
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
