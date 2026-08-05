/**
 * 主 db（studio.db）管理模块。
 *
 * 主 db 只有一张 dataset_registry 表（D7 主 db 层），记录系统里所有数据集的
 * 注册信息（id / 存储配置 / 指纹 / 业务 db 路径 / 激活状态）。
 *
 * 设计要点：
 * - 模块级单例：进程内缓存单个 Database 连接（与 credentials.ts 的模块级常量模式一致）。
 * - 同步 API：better-sqlite3 是同步的，与项目现有 writeFileSync/readFileSync 风格一致。
 * - WAL 模式：提升读并发，本机单用户场景并发低但 WAL 也无坏处。
 * - 目录权限 0700，与 credentials.json 的 0600 同级别保护。
 *
 * 测试隔离：通过 GPT_IMAGE_STUDIO_CONFIG_DIR 环境变量覆盖数据目录（与 credentials.ts 一致），
 * 用 closeMasterDb() 关闭连接后清理临时目录。
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  MASTER_DB_DDL,
  MASTER_DB_MIGRATION_V2,
  MASTER_DB_MIGRATION_V2_ADD_USER_ID,
  MASTER_DB_VERSION,
} from "./schema.js";
import type { DatasetRecord, UserRecord } from "./types.js";

/** Companion 数据根目录。显式 GPT_IMAGE_STUDIO_CONFIG_DIR 优先；默认按部署形态隔离：local = ~/.gpt-image-studio，server = ~/.gpt-image-studio-docker。Docker 显式 /data。 */
export const CONFIG_DIR =
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");

/** 业务 db 存放目录（local 模式：datasets/<id>.db）。 */
export const DATASETS_DIR = join(CONFIG_DIR, "datasets");

/** local 模式的虚拟用户 id（阶段二已有数据集全部归到此用户，零迁移成本）。 */
export const LOCAL_USER_ID = "__local__";

let masterDb: Database.Database | null = null;

/**
 * 打开主 db（单例，进程内缓存）。
 *
 * 首次打开时：建数据目录（0700）+ datasets 子目录（0700）+ 建表 + 设 user_version + 迁移。
 * 后续调用返回缓存的连接。
 *
 * 迁移：旧库（v1）通过 migrateMasterDb 升级到 v2（加 users 表 + user_id 列）。
 */
export function openMasterDb(): Database.Database {
  if (masterDb) return masterDb;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(DATASETS_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(join(CONFIG_DIR, "studio.db"), { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion === 0) {
    // 全新库：直接建最新 schema
    db.exec(MASTER_DB_DDL);
  } else if (currentVersion < MASTER_DB_VERSION) {
    // 旧库：先确保 v1 基础表存在（防 currentVersion 异常），再迁移
    migrateMasterDb(db, currentVersion);
  }
  if (currentVersion < MASTER_DB_VERSION) {
    db.pragma(`user_version = ${MASTER_DB_VERSION}`);
  }
  masterDb = db;
  return db;
}

/**
 * 主 db 迁移（v1 → v2）。
 *
 * v2 引入 users 表 + dataset_registry.user_id 列 + (user_id, fingerprint) 复合唯一索引。
 * ALTER TABLE ADD COLUMN 幂等处理：列已存在时 better-sqlite3 抛 "duplicate column name"，catch 忽略。
 */
function migrateMasterDb(db: Database.Database, fromVersion: number): void {
  if (fromVersion >= 2) return; // 已是 v2+，无需迁移

  // v1 → v2
  // 1. 建 users 表
  db.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);");

  // 2. 加 user_id 列（幂等：列已存在时 catch）
  try {
    db.exec(MASTER_DB_MIGRATION_V2_ADD_USER_ID);
  } catch (err) {
    // "duplicate column name: user_id" → 列已存在，正常情况（部分迁移过的库）
    if (!String(err).includes("duplicate column name")) throw err;
  }

  // 3. 重建索引（删旧全局唯一索引，建 user_id 索引 + 复合唯一索引）
  db.exec(`
    DROP INDEX IF EXISTS idx_registry_fingerprint;
    CREATE INDEX IF NOT EXISTS idx_registry_user ON dataset_registry(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_user_fingerprint ON dataset_registry(user_id, fingerprint);
  `);
}

/**
 * 关闭主 db 连接并清空缓存（测试用）。
 *
 * 生产代码不需要调用——主 db 连接随进程生命周期存在。
 */
export function closeMasterDb(): void {
  if (masterDb) {
    masterDb.close();
    masterDb = null;
  }
}

// ─── users 表 CRUD（阶段三 PR2 多租户） ───

/** 插入一条用户记录。id 冲突时 better-sqlite3 抛 SqliteError。 */
export function insertUser(record: UserRecord): void {
  openMasterDb()
    .prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)")
    .run(record.id, record.display_name, record.created_at);
}

/** 按主键查用户。未命中返回 undefined。 */
export function getUser(id: string): UserRecord | undefined {
  return openMasterDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRecord | undefined;
}

/** 更新用户显示名（JWT claim 可能变化）。 */
export function updateUserDisplayName(id: string, displayName: string): void {
  openMasterDb()
    .prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .run(displayName, id);
}

/** 列出全部用户。 */
export function listUsers(): UserRecord[] {
  return openMasterDb()
    .prepare("SELECT * FROM users ORDER BY created_at")
    .all() as UserRecord[];
}

// ─── dataset_registry CRUD（阶段三 PR2：加 userId 维度） ───

/**
 * 插入一条数据集记录。fingerprint 冲突时 better-sqlite3 抛 SqliteError。
 * record 需含 user_id（local 模式为 '__local__'）。
 */
export function insertDataset(record: DatasetRecord): void {
  const db = openMasterDb();
  db.prepare(`
    INSERT INTO dataset_registry
      (id, user_id, label, storage_kind, storage_config, fingerprint, db_path,
       image_store_kind, created_at, activated_at, is_active)
    VALUES
      (@id, @user_id, @label, @storage_kind, @storage_config, @fingerprint, @db_path,
       @image_store_kind, @created_at, @activated_at, @is_active)
  `).run(record);
}

/**
 * 按配置指纹查数据集（用于 D7 配置去重）。
 * 多租户：同一指纹在不同用户下可各自存在（(user_id, fingerprint) 唯一）。
 */
export function findDatasetByFingerprint(
  fingerprint: string,
  userId: string = LOCAL_USER_ID,
): DatasetRecord | undefined {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry WHERE user_id = ? AND fingerprint = ?")
    .get(userId, fingerprint) as DatasetRecord | undefined;
}

/** 按主键查数据集。未命中返回 undefined。 */
export function getDataset(id: string, userId: string = LOCAL_USER_ID): DatasetRecord | undefined {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry WHERE id = ? AND user_id = ?")
    .get(id, userId) as DatasetRecord | undefined;
}

/**
 * 获取指定用户的当前激活数据集（is_active=1 且 activated_at 最大）。
 * 多租户：每个用户有自己的激活态（local 模式 userId='__local__' 只有一个用户）。
 */
export function getActiveDataset(userId: string = LOCAL_USER_ID): DatasetRecord | undefined {
  return openMasterDb()
    .prepare(
      "SELECT * FROM dataset_registry WHERE user_id = ? AND is_active = 1 ORDER BY activated_at DESC LIMIT 1",
    )
    .get(userId) as DatasetRecord | undefined;
}

/** 列出指定用户的全部数据集，按最近激活时间倒序。 */
export function listDatasets(userId: string = LOCAL_USER_ID): DatasetRecord[] {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry WHERE user_id = ? ORDER BY activated_at DESC")
    .all(userId) as DatasetRecord[];
}

/**
 * 激活某用户的数据集（事务保证原子性）。
 *
 * 步骤：先把该用户的所有记录 is_active 置 0，再把目标记录置 1 + 更新 activated_at。
 * 多租户：WHERE user_id 限定重置范围，不影响其他用户。
 */
export function activateDataset(id: string, now: string, userId: string = LOCAL_USER_ID): void {
  const db = openMasterDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE dataset_registry SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare(
      "UPDATE dataset_registry SET is_active = 1, activated_at = ? WHERE id = ? AND user_id = ?",
    ).run(now, id, userId);
  });
  tx();
}

/** 删除数据集记录（限指定用户，防越权删别人数据集；不删业务 db 文件）。 */
export function deleteDataset(id: string, userId: string = LOCAL_USER_ID): void {
  openMasterDb()
    .prepare("DELETE FROM dataset_registry WHERE id = ? AND user_id = ?")
    .run(id, userId);
}

/** 重命名数据集（限指定用户，防越权）。 */
export function renameDataset(id: string, label: string, userId: string = LOCAL_USER_ID): void {
  openMasterDb()
    .prepare("UPDATE dataset_registry SET label = ? WHERE id = ? AND user_id = ?")
    .run(label, id, userId);
}
