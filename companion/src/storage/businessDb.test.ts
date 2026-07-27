import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("user_version 设置为 BUSINESS_DB_VERSION", async () => {
    const { openBusinessDb, closeAllBusinessDbs } = await loadModules();
    const db = openBusinessDb(dbPath());
    expect(db.pragma("user_version", { simple: true })).toBe(1);
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
