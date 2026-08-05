import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 业务 db（datasets/<id>.db）的单元测试。
 *
 * 业务 db 是独立 SQLite 文件，每个数据集一个。测试用临时目录隔离，
 * 直接构造 dbPath 传给 openBusinessDb，不依赖主 db 的 dataset_registry。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-bizdb-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadModules() {
  return await import("./businessDb.js");
}

/** 拿一个临时业务 db 路径。 */
function dbPath(name = "test.db"): string {
  return join(tempDir, name);
}

describe("openBusinessDb", () => {
  it("首次打开创建 7 张业务表", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const db = openBusinessDb(dbPath());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).filter((n) => !n.startsWith("sqlite_"));
    expect(names).toEqual(
      [
        "analyticsEvents",
        "conversationDrafts",
        "conversations",
        "imageAssets",
        "imageBlobs",
        "messages",
        "settings",
      ],
    );
    closeAllBusinessDbs();
  });

  it("二次调用同 dbPath 返回缓存实例", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    const a = openBusinessDb(path);
    const b = openBusinessDb(path);
    expect(a).toBe(b);
    closeAllBusinessDbs();
  });

  it("不同 dbPath 返回不同实例", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const a = openBusinessDb(dbPath("a.db"));
    const b = openBusinessDb(dbPath("b.db"));
    expect(a).not.toBe(b);
    closeAllBusinessDbs();
  });

  it("user_version 设置为 BUSINESS_DB_VERSION（v2 真实列）", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const db = openBusinessDb(dbPath());
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    closeAllBusinessDbs();
  });

  it("closeBusinessDb 关闭指定连接", async () => {
    const { openBusinessDb, closeBusinessDb, closeAllBusinessDbs } =
      await loadModules();
    const path = dbPath();
    const a = openBusinessDb(path);
    closeBusinessDb(path);
    const b = openBusinessDb(path);
    expect(a).not.toBe(b); // 关闭后重开是新实例
    closeAllBusinessDbs();
  });
});

describe("业务表 CRUD", () => {
  it("listTable 空表返回 []", async () => {
    const { listTable, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    expect(listTable(path, "conversations")).toEqual([]);
    closeAllBusinessDbs();
  });

  it("putRecord + getRecord 往返一致", async () => {
    const { putRecord, getRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { id: "m1", text: "hello", n: 42 });
    expect(getRecord(path, "messages", "m1")).toEqual({ id: "m1", text: "hello", n: 42 });
    closeAllBusinessDbs();
  });

  it("getRecord 未命中返回 undefined", async () => {
    const { getRecord, closeAllBusinessDbs } = await loadModules();
    expect(getRecord(dbPath(), "messages", "nope")).toBeUndefined();
    closeAllBusinessDbs();
  });

  it("putRecord 是 upsert：同 key 反复 put 只留最后值", async () => {
    const { putRecord, getRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { v: 1 });
    putRecord(path, "messages", "m1", { v: 2 });
    putRecord(path, "messages", "m1", { v: 3 });
    expect(getRecord(path, "messages", "m1")).toEqual({ v: 3 });
    closeAllBusinessDbs();
  });

  it("deleteRecord 不存在的 key 是 no-op", async () => {
    const { deleteRecord, listTable, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    expect(() => deleteRecord(path, "messages", "nope")).not.toThrow();
    expect(listTable(path, "messages")).toEqual([]);
    closeAllBusinessDbs();
  });

  it("deleteRecord 删除后 getRecord 返回 undefined", async () => {
    const { putRecord, deleteRecord, getRecord, closeAllBusinessDbs } =
      await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { v: 1 });
    deleteRecord(path, "messages", "m1");
    expect(getRecord(path, "messages", "m1")).toBeUndefined();
    closeAllBusinessDbs();
  });

  it("clearTable 只清当前表，不影响其它表", async () => {
    const { putRecord, clearTable, listTable, closeAllBusinessDbs } =
      await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { v: 1 });
    putRecord(path, "conversations", "c1", { v: 2 });
    clearTable(path, "messages");
    expect(listTable(path, "messages")).toEqual([]);
    expect(listTable(path, "conversations")).toEqual([{ v: 2 }]);
    closeAllBusinessDbs();
  });

  it("listTable 返回全部记录（反序列化 JSON）", async () => {
    const { putRecord, listTable, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { id: "m1" });
    putRecord(path, "messages", "m2", { id: "m2" });
    putRecord(path, "messages", "m3", { id: "m3" });
    const list = listTable(path, "messages");
    expect(list).toHaveLength(3);
    expect(list).toEqual(expect.arrayContaining([{ id: "m1" }, { id: "m2" }, { id: "m3" }]));
    closeAllBusinessDbs();
  });

  it("JSON 嵌套对象正确序列化/反序列化", async () => {
    const { putRecord, getRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    const nested = { id: "x", meta: { tags: ["a", "b"], nested: { deep: true } }, arr: [1, 2, 3] };
    putRecord(path, "conversations", "x", nested);
    expect(getRecord(path, "conversations", "x")).toEqual(nested);
    closeAllBusinessDbs();
  });

  it("7 张表各自独立（写入互不影响）", async () => {
    const { putRecord, listTable, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    const tables = [
      "conversations", "messages", "imageAssets", "imageBlobs",
      "settings", "conversationDrafts", "analyticsEvents",
    ] as const;
    for (const t of tables) {
      putRecord(path, t, "k1", { table: t });
    }
    for (const t of tables) {
      expect(listTable(path, t)).toEqual([{ table: t }]);
    }
    closeAllBusinessDbs();
  });
});

describe("错误处理", () => {
  it("非法表名抛 STORAGE_INVALID_TABLE", async () => {
    const { listTable, closeAllBusinessDbs } = await loadModules();
    // @ts-expect-error 故意传非法表名测运行时校验
    expect(() => listTable(dbPath(), "malicious; DROP TABLE")).toThrow(
      /未知的业务表名/,
    );
    closeAllBusinessDbs();
  });

  it("putRecord 空字符串 key 抛 STORAGE_INVALID_KEY", async () => {
    const { putRecord, closeAllBusinessDbs } = await loadModules();
    expect(() => putRecord(dbPath(), "messages", "", { v: 1 })).toThrow(
      /key 不能为空/,
    );
    closeAllBusinessDbs();
  });

  it("putRecord 循环引用对象抛 STORAGE_SERIALIZATION", async () => {
    const { putRecord, closeAllBusinessDbs } = await loadModules();
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => putRecord(dbPath(), "messages", "k", cyclic)).toThrow(
      /JSON 序列化失败/,
    );
    closeAllBusinessDbs();
  });
});

describe("listPage 分页查询", () => {
  /** 造 n 条消息，createdAt 从基准时间逐分钟递增。 */
  function seedMessages(
    putRecord: (dbPath: string, table: "messages", key: string, value: unknown) => void,
    path: string,
    n: number,
    conversationId = "c1",
  ): string[] {
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const key = `m${String(i).padStart(3, "0")}`;
      putRecord(path, "messages", key, {
        id: key,
        conversationId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      });
      keys.push(key);
    }
    return keys;
  }

  it("DESC 排序 + limit + nextCursor 翻页遍历：不重不漏，末页 nextCursor=null", async () => {
    const { putRecord, listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    seedMessages(putRecord, path, 5);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = listPage<{ id: string }>(path, "messages", {
        before: cursor,
        limit: 2,
      });
      seen.push(...result.data.map((m) => m.id));
      expect(result.total).toBe(5);
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    // 5 条全部取到、无重复、DESC（最新在前）
    expect(seen).toEqual(["m004", "m003", "m002", "m001", "m000"]);
    closeAllBusinessDbs();
  });

  it("conversations 按 updatedAt DESC 分页", async () => {
    const { putRecord, listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    for (let i = 0; i < 3; i++) {
      putRecord(path, "conversations", `c${i}`, {
        id: `c${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      });
    }
    const result = listPage<{ id: string }>(path, "conversations", { limit: 2 });
    expect(result.data.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(result.nextCursor).not.toBeNull();
    expect(result.total).toBe(3);
    closeAllBusinessDbs();
  });

  it("conversationId 过滤：只回该会话记录，total 只算过滤后", async () => {
    const { putRecord, listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    for (let i = 0; i < 3; i++) {
      putRecord(path, "messages", `a${i}`, {
        id: `a${i}`,
        conversationId: "c1",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      });
    }
    for (let i = 0; i < 2; i++) {
      putRecord(path, "messages", `b${i}`, {
        id: `b${i}`,
        conversationId: "c2",
        createdAt: new Date(Date.UTC(2026, 0, 1, 1, i)).toISOString(),
      });
    }
    const result = listPage<{ id: string }>(path, "messages", {
      conversationId: "c1",
      limit: 10,
    });
    expect(result.data.map((m) => m.id)).toEqual(["a2", "a1", "a0"]);
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBeNull();
    closeAllBusinessDbs();
  });

  it("相同排序值的多条记录跨页不漏不重（key tiebreak）", async () => {
    const { putRecord, listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    const sameTs = new Date(Date.UTC(2026, 0, 1)).toISOString();
    for (let i = 0; i < 5; i++) {
      putRecord(path, "messages", `m${i}`, { id: `m${i}`, createdAt: sameTs });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = listPage<{ id: string }>(path, "messages", {
        before: cursor,
        limit: 2,
      });
      seen.push(...result.data.map((m) => m.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    closeAllBusinessDbs();
  });

  it("不支持分页的表（settings）抛 STORAGE_INVALID_QUERY", async () => {
    const { listPage, closeAllBusinessDbs } = await loadModules();
    expect(() => listPage(dbPath(), "settings", { limit: 10 })).toThrow(
      /不支持分页查询/,
    );
    closeAllBusinessDbs();
  });

  it("conversations 传 conversationId 抛 STORAGE_INVALID_QUERY", async () => {
    const { listPage, closeAllBusinessDbs } = await loadModules();
    expect(() =>
      listPage(dbPath(), "conversations", { conversationId: "c1", limit: 10 }),
    ).toThrow(/不支持 conversationId 过滤/);
    closeAllBusinessDbs();
  });

  it("limit 非法（0 / 负数 / 超上限 / 非整数）抛 STORAGE_INVALID_QUERY", async () => {
    const { listPage, LIST_PAGE_MAX_LIMIT, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    for (const bad of [0, -1, LIST_PAGE_MAX_LIMIT + 1, 1.5, NaN]) {
      expect(() => listPage(path, "messages", { limit: bad })).toThrow(/limit 必须/);
    }
    closeAllBusinessDbs();
  });

  it("非法游标抛 STORAGE_INVALID_CURSOR", async () => {
    const { listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    expect(() => listPage(path, "messages", { before: "not-a-cursor", limit: 10 })).toThrow(
      /游标无法解析/,
    );
    // base64 合法但结构不对也抛
    const wrongShape = Buffer.from(JSON.stringify({ a: 1 })).toString("base64url");
    expect(() => listPage(path, "messages", { before: wrongShape, limit: 10 })).toThrow(
      /游标无法解析/,
    );
    closeAllBusinessDbs();
  });
});

describe("v1 → v2 迁移（真实列）", () => {
  /** 手工造一个 v1 旧库：纯 KV 结构（无派生列）+ 两条存量数据 + user_version=1。 */
  function buildV1Db(path: string): void {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE conversations      (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE messages           (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE imageAssets        (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE imageBlobs         (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE settings           (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE conversationDrafts (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE analyticsEvents    (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO messages (key, value) VALUES (?, ?)").run(
      "m1",
      JSON.stringify({ id: "m1", conversationId: "c1", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    db.prepare("INSERT INTO messages (key, value) VALUES (?, ?)").run(
      "m2",
      JSON.stringify({ id: "m2", conversationId: "c2", createdAt: "2026-01-02T00:00:00.000Z" }),
    );
    db.prepare("INSERT INTO conversations (key, value) VALUES (?, ?)").run(
      "c1",
      JSON.stringify({ id: "c1", updatedAt: "2026-01-03T00:00:00.000Z" }),
    );
    db.pragma("user_version = 1");
    db.close();
  }

  it("打开 v1 旧库：加列 + 回填存量数据 + 版本升 2", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    buildV1Db(path);

    const db = openBusinessDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(2);

    // 列已加
    const messageCols = (db.pragma("table_info(messages)") as { name: string }[]).map(
      (c) => c.name,
    );
    expect(messageCols).toEqual(["key", "value", "created_at", "conversation_id"]);

    // 存量行已回填
    const rows = db
      .prepare("SELECT key, created_at, conversation_id FROM messages ORDER BY key")
      .all() as { key: string; created_at: string; conversation_id: string }[];
    expect(rows).toEqual([
      { key: "m1", created_at: "2026-01-01T00:00:00.000Z", conversation_id: "c1" },
      { key: "m2", created_at: "2026-01-02T00:00:00.000Z", conversation_id: "c2" },
    ]);
    const conv = db
      .prepare("SELECT updated_at FROM conversations WHERE key = 'c1'")
      .get() as { updated_at: string };
    expect(conv.updated_at).toBe("2026-01-03T00:00:00.000Z");
    closeAllBusinessDbs();
  });

  it("迁移后的旧库 listPage 分页/过滤正常", async () => {
    const { openBusinessDb, listPage, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    buildV1Db(path);
    openBusinessDb(path); // 触发迁移

    const filtered = listPage<{ id: string }>(path, "messages", {
      conversationId: "c1",
      limit: 10,
    });
    expect(filtered.data.map((m) => m.id)).toEqual(["m1"]);
    expect(filtered.total).toBe(1);

    const all = listPage<{ id: string }>(path, "messages", { limit: 1 });
    expect(all.data.map((m) => m.id)).toEqual(["m2"]); // DESC 最新在前
    expect(all.nextCursor).not.toBeNull();
    closeAllBusinessDbs();
  });

  it("迁移幂等：v2 库重复打开不报错、数据不变", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    buildV1Db(path);
    openBusinessDb(path);
    closeAllBusinessDbs(); // 清缓存强制重连
    const db = openBusinessDb(path); // 二次打开：版本已是 2，不再迁移
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    const n = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(n.n).toBe(2);
    closeAllBusinessDbs();
  });
});

describe("派生列写入", () => {
  it("putRecord 同步填充派生列", async () => {
    const { openBusinessDb, putRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", {
      id: "m1",
      conversationId: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const db = openBusinessDb(path);
    const row = db
      .prepare("SELECT created_at, conversation_id FROM messages WHERE key = 'm1'")
      .get() as { created_at: string; conversation_id: string };
    expect(row).toEqual({
      created_at: "2026-01-01T00:00:00.000Z",
      conversation_id: "c1",
    });
    closeAllBusinessDbs();
  });

  it("upsert 覆盖时派生列同步更新", async () => {
    const { openBusinessDb, putRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { id: "m1", conversationId: "c1", createdAt: "2026-01-01T00:00:00.000Z" });
    putRecord(path, "messages", "m1", { id: "m1", conversationId: "c2", createdAt: "2026-01-02T00:00:00.000Z" });
    const db = openBusinessDb(path);
    const row = db
      .prepare("SELECT created_at, conversation_id FROM messages WHERE key = 'm1'")
      .get() as { created_at: string; conversation_id: string };
    expect(row).toEqual({
      created_at: "2026-01-02T00:00:00.000Z",
      conversation_id: "c2",
    });
    closeAllBusinessDbs();
  });

  it("字段缺失的记录派生列为 NULL", async () => {
    const { openBusinessDb, putRecord, closeAllBusinessDbs } = await loadModules();
    const path = dbPath();
    putRecord(path, "messages", "m1", { id: "m1" });
    const db = openBusinessDb(path);
    const row = db
      .prepare("SELECT created_at, conversation_id FROM messages WHERE key = 'm1'")
      .get() as { created_at: string | null; conversation_id: string | null };
    expect(row.created_at).toBeNull();
    expect(row.conversation_id).toBeNull();
    closeAllBusinessDbs();
  });
});
