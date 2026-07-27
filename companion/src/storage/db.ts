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
import { MASTER_DB_DDL, MASTER_DB_VERSION } from "./schema.js";
import type { DatasetRecord } from "./types.js";

/** Companion 数据根目录（与 credentials.ts 的 CONFIG_DIR 对齐）。 */
export const CONFIG_DIR =
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");

/** 业务 db 存放目录（datasets/<id>.db）。 */
export const DATASETS_DIR = join(CONFIG_DIR, "datasets");

let masterDb: Database.Database | null = null;

/**
 * 打开主 db（单例，进程内缓存）。
 *
 * 首次打开时：建数据目录（0700）+ datasets 子目录（0700）+ 建表 + 设 user_version。
 * 后续调用返回缓存的连接。
 */
export function openMasterDb(): Database.Database {
  if (masterDb) return masterDb;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(DATASETS_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(join(CONFIG_DIR, "studio.db"), { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.exec(MASTER_DB_DDL);
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion < MASTER_DB_VERSION) {
    db.pragma(`user_version = ${MASTER_DB_VERSION}`);
  }
  masterDb = db;
  return db;
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

// ─── dataset_registry CRUD ───

/** 插入一条数据集记录。fingerprint 冲突时 better-sqlite3 抛 SqliteError。 */
export function insertDataset(record: DatasetRecord): void {
  const db = openMasterDb();
  db.prepare(`
    INSERT INTO dataset_registry
      (id, label, storage_kind, storage_config, fingerprint, db_path,
       image_store_kind, created_at, activated_at, is_active)
    VALUES
      (@id, @label, @storage_kind, @storage_config, @fingerprint, @db_path,
       @image_store_kind, @created_at, @activated_at, @is_active)
  `).run(record);
}

/** 按配置指纹查数据集（用于 D7 配置去重）。未命中返回 undefined。 */
export function findDatasetByFingerprint(fingerprint: string): DatasetRecord | undefined {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry WHERE fingerprint = ?")
    .get(fingerprint) as DatasetRecord | undefined;
}

/** 按主键查数据集。未命中返回 undefined。 */
export function getDataset(id: string): DatasetRecord | undefined {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry WHERE id = ?")
    .get(id) as DatasetRecord | undefined;
}

/** 获取当前激活的数据集（is_active=1 且 activated_at 最大）。本机模式同时只有一个 active。 */
export function getActiveDataset(): DatasetRecord | undefined {
  return openMasterDb()
    .prepare(
      "SELECT * FROM dataset_registry WHERE is_active = 1 ORDER BY activated_at DESC LIMIT 1",
    )
    .get() as DatasetRecord | undefined;
}

/** 列出全部数据集，按最近激活时间倒序。 */
export function listDatasets(): DatasetRecord[] {
  return openMasterDb()
    .prepare("SELECT * FROM dataset_registry ORDER BY activated_at DESC")
    .all() as DatasetRecord[];
}

/**
 * 激活某数据集（事务保证原子性）。
 *
 * 步骤：先把所有记录 is_active 置 0，再把目标记录置 1 + 更新 activated_at。
 * 用 better-sqlite3 的 transaction 包裹，两条 UPDATE 要么全成功要么全回滚。
 * 对不存在的 id：UPDATE 0 行，不报错（符合 SQL 语义；调用方应先 getDataset 校验）。
 */
export function activateDataset(id: string, now: string): void {
  const db = openMasterDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE dataset_registry SET is_active = 0").run();
    db.prepare(
      "UPDATE dataset_registry SET is_active = 1, activated_at = ? WHERE id = ?",
    ).run(now, id);
  });
  tx();
}

/** 删除数据集记录（不删业务 db 文件——文件删除由调用方负责，避免库越权）。 */
export function deleteDataset(id: string): void {
  openMasterDb().prepare("DELETE FROM dataset_registry WHERE id = ?").run(id);
}

/** 重命名数据集（只改 label）。 */
export function renameDataset(id: string, label: string): void {
  openMasterDb()
    .prepare("UPDATE dataset_registry SET label = ? WHERE id = ?")
    .run(label, id);
}
