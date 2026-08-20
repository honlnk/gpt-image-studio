import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqliteDatabase, SQLITE_DRIVER } from "./sqliteDriver.js";

/**
 * 驱动适配层契约测试（Node 分支 = better-sqlite3 原生透传）。
 * Bun 分支（bun:sqlite 包装）由 sidecar 冒烟验证（scripts/build-sidecar 产物），
 * vitest 的 node 环境无法运行 bun:sqlite。
 */
describe("sqliteDriver", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gis-sqlite-driver-test-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("runs on the better-sqlite3 driver under node", () => {
    expect(SQLITE_DRIVER).toBe("better-sqlite3");
  });

  it("creates a database and round-trips rows via prepare/run/get/all", () => {
    const db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE t (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO t (key, value) VALUES (?, ?)").run("k1", "v1");

    expect(db.prepare("SELECT value FROM t WHERE key = ?").get("k1")).toEqual({
      value: "v1",
    });
    expect(db.prepare("SELECT * FROM t").all()).toHaveLength(1);
    db.close();
  });

  it("reads and writes user_version through pragma", () => {
    const db = openSqliteDatabase(dbPath);
    expect(db.pragma("user_version", { simple: true })).toBe(0);
    db.pragma("user_version = 7");
    expect(db.pragma("user_version", { simple: true })).toBe(7);
    db.close();
  });

  it("get() returns undefined for a missing row", () => {
    const db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE t (key TEXT PRIMARY KEY)");
    expect(db.prepare("SELECT * FROM t WHERE key = ?").get("nope")).toBeUndefined();
    db.close();
  });

  it("runs transaction bodies atomically", () => {
    const db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE t (key TEXT PRIMARY KEY)");
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO t (key) VALUES (?)").run("a");
      db.prepare("INSERT INTO t (key) VALUES (?)").run("b");
    });
    tx();
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 2 });
    db.close();
  });
});
