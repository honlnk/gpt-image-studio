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
import { openSqliteDatabase, type SqliteDatabase } from "./sqliteDriver.js";
import {
  BUSINESS_DB_DDL,
  BUSINESS_DB_INDEXES,
  BUSINESS_DB_MIGRATION_V2_BACKFILL,
  BUSINESS_DB_MIGRATION_V2_COLUMNS,
  BUSINESS_DB_VERSION,
  BUSINESS_TABLES,
  TABLE_QUERY_COLUMNS,
  isBusinessTable,
} from "./schema.js";
import type { BusinessTable } from "./schema.js";
import { StorageStoreError } from "./errors.js";

/** dbPath → Database 连接缓存。 */
const dbCache = new Map<string, SqliteDatabase>();

/**
 * 打开某数据集的业务 db（按 dbPath 缓存）。
 *
 * 首次打开：建表 → 按需迁移（旧库补列+回填）→ 建索引 → 设 user_version。
 * 索引必须在迁移之后建：v1 旧库要先 ALTER 出派生列，CREATE INDEX 才不报错。
 * 后续调用返回缓存连接。WAL 模式提升读并发。
 */
export function openBusinessDb(dbPath: string): SqliteDatabase {
  const cached = dbCache.get(dbPath);
  if (cached) return cached;
  const db = openSqliteDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(BUSINESS_DB_DDL);
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion < BUSINESS_DB_VERSION) {
    migrateBusinessDb(db, currentVersion);
    db.pragma(`user_version = ${BUSINESS_DB_VERSION}`);
  }
  db.exec(BUSINESS_DB_INDEXES);
  dbCache.set(dbPath, db);
  return db;
}

/**
 * 业务 db 版本迁移。当前只有 v1 → v2（真实列，server 模式分页 PR-a 方案 B）：
 * 1. ALTER ADD COLUMN 加派生查询列——新库走 v2 DDL 列已存在，撞 duplicate column
 *    属正常路径，catch 忽略（与主 db MASTER_DB_MIGRATION_V2 同模式）；
 * 2. UPDATE 回填存量行（幂等，新库空表是 no-op）。
 * 索引不在此处理：openBusinessDb 在迁移后统一执行 BUSINESS_DB_INDEXES。
 */
function migrateBusinessDb(db: SqliteDatabase, fromVersion: number): void {
  if (fromVersion < 2) {
    const migrate = db.transaction(() => {
      for (const stmt of BUSINESS_DB_MIGRATION_V2_COLUMNS) {
        try {
          db.exec(stmt);
        } catch (err) {
          if (!/duplicate column/.test(String(err))) throw err;
        }
      }
      db.exec(BUSINESS_DB_MIGRATION_V2_BACKFILL);
    });
    migrate();
  }
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

/** upsert：key 存在则覆盖，不存在则插入。有派生查询列的表同步填充列。 */
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
  const queryColumns = TABLE_QUERY_COLUMNS[table];
  if (!queryColumns) {
    // 纯 KV 表
    db.prepare(
      `INSERT INTO ${table} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, serialized);
    return;
  }
  // 派生列从业务对象取值（列名来自 schema.ts 静态配置，非用户输入，可安全拼 SQL）。
  // 字段缺失/非字符串 → NULL（DESC 序排最后，视为脏数据容忍）。
  const record = value as Record<string, unknown> | null;
  const columnNames = Object.keys(queryColumns);
  const columnValues = columnNames.map((col) => {
    const fieldValue = record?.[queryColumns[col]];
    return typeof fieldValue === "string" ? fieldValue : null;
  });
  const columnList = columnNames.join(", ");
  const placeholders = columnNames.map(() => "?").join(", ");
  const updateSet = columnNames.map((c) => `${c} = excluded.${c}`).join(", ");
  db.prepare(
    `INSERT INTO ${table} (key, value, ${columnList}) VALUES (?, ?, ${placeholders})
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, ${updateSet}`,
  ).run(key, serialized, ...columnValues);
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

// ─── 分页查询（server 模式全链路分页 PR-a） ───
//
// 设计决策（docs/evolution/backlog-server-pagination.md §3.1 方案 B）：
// 三张可分页表带真实派生列（schema v2），排序/过滤走正规 B-tree 索引。
// value JSON 仍是数据真相源，列只是写入时派生的查询材料（putRecord 填充）。

/**
 * 各表的服务端排序列（真实列名）。只有列在这里的表支持分页参数；
 * 排序统一 DESC（最新在前），客户端要正序展示时自行 reverse（如聊天消息）。
 * 列内容是 ISO 8601 字符串，字典序 = 时间序。
 */
const TABLE_SORT_COLUMNS: Partial<Record<BusinessTable, string>> = {
  conversations: "updated_at",
  messages: "created_at",
  imageAssets: "created_at",
};

/** 支持 conversationId 过滤的表（有 conversation_id 列）。 */
const CONVERSATION_FILTERABLE_TABLES: readonly BusinessTable[] = [
  "messages",
  "imageAssets",
];

/** limit 上限，防客户端请求过大页拖垮服务。 */
export const LIST_PAGE_MAX_LIMIT = 200;

/** limit 缺省值（分页参数出现但没显式给 limit 时）。 */
export const LIST_PAGE_DEFAULT_LIMIT = 50;

export type ListPageOptions = {
  /** 按 conversationId 过滤（仅 messages / imageAssets 支持）。 */
  conversationId?: string;
  /** 上一页返回的 nextCursor（opaque 字符串），取"比该游标更早"的一页。 */
  before?: string;
  /** 页大小，1..LIST_PAGE_MAX_LIMIT。 */
  limit: number;
};

export type ListPageResult<T> = {
  /** 本页记录，按排序字段 DESC（最新在前）。 */
  data: T[];
  /** 还有更早记录时为下一页游标，否则 null。 */
  nextCursor: string | null;
  /** 满足过滤条件（conversationId）的总条数，不受 before/limit 影响，供"共 N 条"计数。 */
  total: number;
};

/**
 * opaque 游标：base64url(JSON([排序值, key]))。
 * 双字段是为了排序值相同时的稳定 tiebreak（同毫秒创建的多条记录跨页不漏不重）。
 * 对客户端不透明——只允许原样回传，不允许自行构造。
 */
function encodeCursor(sortValue: string | null, key: string): string {
  return Buffer.from(JSON.stringify([sortValue, key]), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): [string | null, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === "string" || parsed[0] === null) &&
      typeof parsed[1] === "string"
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // fallthrough：JSON/base64 解析失败统一走下面的 INVALID_CURSOR
  }
  throw new StorageStoreError("分页游标无法解析", "STORAGE_INVALID_CURSOR");
}

/**
 * 分页查询：按排序列 DESC 取一页。
 *
 * 已知边界：排序列缺失的记录（NULL）在 DESC 序里排最后，
 * 且翻页谓词 `col < ?` 对 NULL 不成立——这类记录不可经游标翻到。
 * 业务上三张可分页表的记录都带排序字段（会话 updatedAt / 消息与图片 createdAt），
 * 无排序字段视为脏数据，不为其设计兜底。
 */
export function listPage<T = unknown>(
  dbPath: string,
  table: BusinessTable,
  opts: ListPageOptions,
): ListPageResult<T> {
  assertTable(table);
  const sortColumn = TABLE_SORT_COLUMNS[table];
  if (!sortColumn) {
    throw new StorageStoreError(`表 ${table} 不支持分页查询`, "STORAGE_INVALID_QUERY");
  }
  if (opts.conversationId !== undefined && !CONVERSATION_FILTERABLE_TABLES.includes(table)) {
    throw new StorageStoreError(
      `表 ${table} 不支持 conversationId 过滤`,
      "STORAGE_INVALID_QUERY",
    );
  }
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > LIST_PAGE_MAX_LIMIT) {
    throw new StorageStoreError(
      `limit 必须是 1..${LIST_PAGE_MAX_LIMIT} 的整数`,
      "STORAGE_INVALID_QUERY",
    );
  }

  const db = openBusinessDb(dbPath);

  // 过滤条件（conversationId）——total 与分页共用
  const conditions: string[] = [];
  const filterParams: unknown[] = [];
  if (opts.conversationId !== undefined) {
    conditions.push("conversation_id = ?");
    filterParams.push(opts.conversationId);
  }
  const filterWhere = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}${filterWhere}`)
    .get(...filterParams) as { n: number };

  // before 游标展开成 (排序值, key) 双字段谓词
  const pageParams = [...filterParams];
  if (opts.before !== undefined) {
    const [cursorSort, cursorKey] = decodeCursor(opts.before);
    // DESC 序下"更早" = 排序值更小，或排序值相等时 key 更小
    conditions.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND key < ?))`);
    pageParams.push(cursorSort, cursorSort, cursorKey);
  }
  const pageWhere = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

  // 多取 1 条判断是否还有下一页
  const rows = db
    .prepare(
      `SELECT key, value, ${sortColumn} AS sortv FROM ${table}${pageWhere}
       ORDER BY ${sortColumn} DESC, key DESC LIMIT ?`,
    )
    .all(...pageParams, opts.limit + 1) as { key: string; value: string; sortv: string | null }[];

  const hasMore = rows.length > opts.limit;
  const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    data: pageRows.map((r) => deserialize<T>(r.value, table)),
    nextCursor: hasMore && last ? encodeCursor(last.sortv, last.key) : null,
    total: totalRow.n,
  };
}

/**
 * 估算某业务 db 的元数据总字节（用于 estimateStoredBytes）。
 *
 * 算法：对 7 张表分别 SUM(LENGTH(value))，累加。LENGTH 对 TEXT 列返回字符数，
 * 与字节数在纯 ASCII 下相等；含多字节 UTF-8 时略小于真实字节，作为估算可接受
 * （与 IndexedDB 实现的 list+累加 JSON.stringify 长度量级一致）。
 */
export function estimateMetadataBytes(dbPath: string): number {
  const db = openBusinessDb(dbPath);
  let total = 0;
  for (const table of BUSINESS_TABLES) {
    const row = db
      .prepare(`SELECT COALESCE(SUM(LENGTH(value)), 0) AS bytes FROM ${table}`)
      .get() as { bytes: number } | undefined;
    total += row?.bytes ?? 0;
  }
  return total;
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
