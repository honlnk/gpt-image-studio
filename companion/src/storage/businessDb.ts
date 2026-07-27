/**
 * 业务 db（datasets/<id>.db）管理模块。
 *
 * 每个数据集一个独立业务 db 文件（D7 业务 db 层），内部 schema = 7 张业务表
 *（conversations / messages / imageAssets / imageBlobs / settings /
 *  conversationDrafts / analyticsEvents），表结构见 schema.ts。
 *
 * 设计要点：
 * - 按 dbPath 缓存连接：同一业务 db 的多次 CRUD 复用连接，避免频繁 open/close。
 * - 同步 API：与 db.ts、credentials.ts 风格一致。
 * - CRUD 函数式导出：listTable / getRecord / putRecord / deleteRecord / clearTable，
 *   语义与前端 StudioStorage 接口（list/get/put/delete/clear）一一对应。
 * - 表名白名单校验：拼 SQL 前用 isBusinessTable 校验，防注入（表名无法参数化）。
 *
 * 注意：本模块不关心「当前激活哪个数据集」——那是 datasetRegistry.ts 的职责。
 * 本模块只按 dbPath 操作具体业务 db。路由层调用时会先查 active dataset 拿到 dbPath，
 * 再传给本模块的函数。
 */
import Database from "better-sqlite3";
import { BUSINESS_DB_DDL, BUSINESS_DB_VERSION, isBusinessTable } from "./schema.js";
import type { BusinessTable } from "./schema.js";
import { StorageStoreError } from "./errors.js";

/** dbPath → Database 连接缓存。 */
const dbCache = new Map<string, Database.Database>();

/**
 * 打开某数据集的业务 db（按 dbPath 缓存）。
 *
 * 首次打开：建 7 张表 + 设 user_version。后续调用返回缓存连接。
 * WAL 模式提升读并发。
 */
export function openBusinessDb(dbPath: string): Database.Database {
  const cached = dbCache.get(dbPath);
  if (cached) return cached;
  const db = new Database(dbPath, { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.exec(BUSINESS_DB_DDL);
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion < BUSINESS_DB_VERSION) {
    db.pragma(`user_version = ${BUSINESS_DB_VERSION}`);
  }
  dbCache.set(dbPath, db);
  return db;
}

/**
 * 关闭所有缓存的业务 db 连接并清空缓存（测试用）。
 *
 * 生产代码不需要调用——连接随进程生命周期存在。
 * 场景：数据集删除时需关闭对应连接再删文件（见 datasetRegistry.ts）。
 */
export function closeAllBusinessDbs(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}

/** 关闭指定 dbPath 的连接（数据集删除时用）。无缓存则 no-op。 */
export function closeBusinessDb(dbPath: string): void {
  const db = dbCache.get(dbPath);
  if (db) {
    db.close();
    dbCache.delete(dbPath);
  }
}

// ─── 7 表 CRUD（语义对齐前端 StudioStorage） ───

type Row = { value: string };

/** 列出某表的全部记录（反序列化 JSON）。空表返回 []。 */
export function listTable<T = unknown>(dbPath: string, table: BusinessTable): T[] {
  assertTable(table);
  const db = openBusinessDb(dbPath);
  const rows = db.prepare(`SELECT value FROM ${table}`).all() as Row[];
  return rows.map((r) => deserialize<T>(r.value, table));
}

/** 按 key 取单条（反序列化 JSON）。找不到返回 undefined。 */
export function getRecord<T = unknown>(
  dbPath: string,
  table: BusinessTable,
  key: string,
): T | undefined {
  assertTable(table);
  const db = openBusinessDb(dbPath);
  const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key) as
    | Row
    | undefined;
  return row ? deserialize<T>(row.value, table) : undefined;
}

/** upsert：key 存在则覆盖，不存在则插入。 */
export function putRecord(
  dbPath: string,
  table: BusinessTable,
  key: string,
  value: unknown,
): void {
  assertTable(table);
  assertKey(key);
  const db = openBusinessDb(dbPath);
  const serialized = serialize(value, table);
  db.prepare(
    `INSERT INTO ${table} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, serialized);
}

/** 删单条。key 不存在是 no-op（DELETE 0 行）。 */
export function deleteRecord(dbPath: string, table: BusinessTable, key: string): void {
  assertTable(table);
  assertKey(key);
  openBusinessDb(dbPath).prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
}

/** 清空单表的全部记录。不影响其它表。 */
export function clearTable(dbPath: string, table: BusinessTable): void {
  assertTable(table);
  openBusinessDb(dbPath).prepare(`DELETE FROM ${table}`).run();
}

// ─── 内部工具 ───

function assertTable(table: string): asserts table is BusinessTable {
  if (!isBusinessTable(table)) {
    throw new StorageStoreError(
      `未知的业务表名：${table}`,
      "STORAGE_INVALID_TABLE",
    );
  }
}

function assertKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageStoreError(
      `业务表 key 不能为空字符串`,
      "STORAGE_INVALID_KEY",
    );
  }
}

function serialize(value: unknown, table: BusinessTable): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    throw new StorageStoreError(
      `写入表 ${table} 时 JSON 序列化失败`,
      "STORAGE_SERIALIZATION",
      { cause: err },
    );
  }
}

function deserialize<T>(raw: string, table: BusinessTable): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new StorageStoreError(
      `读取表 ${table} 时 JSON 反序列化失败`,
      "STORAGE_SERIALIZATION",
      { cause: err },
    );
  }
}

export { BUSINESS_TABLES } from "./schema.js";
export type { BusinessTable } from "./schema.js";
