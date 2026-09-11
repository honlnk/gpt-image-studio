/**
 * SQLite 驱动适配层：按运行时选择驱动。
 *
 * - Node 运行时（npm 包 / tsx 开发 / vitest）：better-sqlite3（现状不变）。
 * - Bun 编译的单文件二进制（Tauri sidecar，bun build --compile）：bun:sqlite。
 *   原因：better-sqlite3 的原生 addon 直接依赖 V8 API（非 N-API，每个 Node 大版本
 *   都要重编译），在 Bun 的 JavaScriptCore 运行时无法加载（oven-sh/bun#4290）。
 *   bun:sqlite 是 Bun 内置的同源 SQLite 绑定，API 形状与 better-sqlite3 相近。
 *
 * 本层把两套驱动的差异归一成 better-sqlite3 的形状，适配面以 companion 实际
 * 使用为准（见下方接口）：exec / prepare().run|get|all / transaction /
 * pragma（读 + 写）/ close。未使用的特性（iterate / pluck / raw 等）不进接口。
 *
 * 两套驱动的语义差异处理：
 * - pragma：better-sqlite3 有 pragma 方法（simple 读值 / "k = v" 赋值），
 *   bun:sqlite 没有——读走 query("PRAGMA x")，写走 exec("PRAGMA x = v")。
 * - get() 无行：better-sqlite3 返回 undefined，bun:sqlite 返回 null——统一归一为
 *   undefined（调用方以 falsy 判空，行为一致）。
 * - 驱动加载用 createRequire + 字符串模块名：bun 打包器无法静态内联
 *   better-sqlite3（正好避开其 addon），Node 下照常解析。
 */
import { createRequire } from "node:module";

/** better-sqlite3 风格的语句（companion 实际用到的面）。 */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** better-sqlite3 风格的连接（companion 实际用到的面）。 */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(sql: string, opts?: { simple?: boolean }): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

/** 当前进程选择的 SQLite 驱动。 */
export type SqliteDriverKind = "better-sqlite3" | "bun:sqlite";

const isBunRuntime = Boolean(
  (process.versions as Record<string, string | undefined>).bun,
);

export const SQLITE_DRIVER: SqliteDriverKind = isBunRuntime
  ? "bun:sqlite"
  : "better-sqlite3";

/** bun:sqlite 的最小结构声明（仓库未安装 bun-types，仅声明用到的方法）。 */
type BunSqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

type BunSqliteDatabase = {
  exec(sql: string): unknown;
  query(sql: string): BunSqliteStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};

let openFn: ((path: string) => SqliteDatabase) | null = null;

function loadDriver(): (path: string) => SqliteDatabase {
  if (openFn) return openFn;
  const require = createRequire(import.meta.url);
  if (isBunRuntime) {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string) => BunSqliteDatabase;
    };
    openFn = (path) => wrapBunDatabase(new Database(path));
  } else {
    const Database = require("better-sqlite3") as new (
      path: string,
      opts?: { fileMustExist?: boolean },
    ) => SqliteDatabase;
    openFn = (path) => new Database(path, { fileMustExist: false });
  }
  return openFn;
}

/**
 * 打开 SQLite 连接。创建语义（文件不存在时建库），等价 better-sqlite3 的
 * `new Database(path, { fileMustExist: false })`。
 */
export function openSqliteDatabase(path: string): SqliteDatabase {
  return loadDriver()(path);
}

function wrapBunDatabase(db: BunSqliteDatabase): SqliteDatabase {
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => wrapBunStatement(db.query(sql)),
    pragma: (sql, opts) => {
      if (opts?.simple) {
        const row = db.query(`PRAGMA ${sql}`).get() as Record<string, unknown> | null;
        return row ? Object.values(row)[0] : undefined;
      }
      db.exec(`PRAGMA ${sql}`);
      return undefined;
    },
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}

function wrapBunStatement(stmt: BunSqliteStatement): SqliteStatement {
  return {
    run: (...params) => stmt.run(...params),
    get: (...params) => stmt.get(...params) ?? undefined,
    all: (...params) => stmt.all(...params),
  };
}
