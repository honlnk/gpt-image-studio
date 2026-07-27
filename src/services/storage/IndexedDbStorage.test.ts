/**
 * IndexedDbStorage 专项测试。
 *
 * 覆盖契约套件不测的 IndexedDB 特有行为：
 * - schema 升级（DB_VERSION 历史）
 * - 幂等建表
 * - 索引重命名迁移分支
 * - 并发写
 * - keyPath 正确性
 *
 * 契约套件（storage.contract.test.ts）只断言语义，本文件断言 IndexedDB 特性。
 * 配 fake-indexeddb。注意 fake 与真实 IndexedDB 的行为差异（事务时序、错误类型），
 * 见 evolution-roadmap.md §6.5 缓解策略——关键路径需 manual smoke test。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbStorage } from "./IndexedDbStorage";
import { STORE_NAMES } from "./types";

describe("IndexedDbStorage schema 与 IDB 特性", () => {
  let storage: IndexedDbStorage;

  beforeEach(() => {
    storage = new IndexedDbStorage();
  });

  afterEach(async () => {
    for (const store of Object.values(STORE_NAMES)) {
      await storage.clear(store);
    }
  });

  it("DB 打开后 7 张表全部存在", async () => {
    const db = await storage.getDb();
    expect(db.objectStoreNames.contains(STORE_NAMES.conversations)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.messages)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.imageAssets)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.imageBlobs)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.settings)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.conversationDrafts)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_NAMES.analyticsEvents)).toBe(true);
    expect(db.objectStoreNames.length).toBe(7);
  });

  it("DB 版本为 4", async () => {
    const db = await storage.getDb();
    expect(db.version).toBe(4);
  });

  it("幂等 open：同一实例多次 getDb 返回同一 promise", async () => {
    const p1 = storage.getDb();
    const p2 = storage.getDb();
    expect(p1).toBe(p2);
    const db1 = await p1;
    const db2 = await p2;
    expect(db1).toBe(db2);
  });

  it("7 张表的 keyPath 与 schema 定义一致", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(
      Object.values(STORE_NAMES),
      "readonly",
    );
    expect(tx.objectStore(STORE_NAMES.conversations).keyPath).toBe("id");
    expect(tx.objectStore(STORE_NAMES.messages).keyPath).toBe("id");
    expect(tx.objectStore(STORE_NAMES.imageAssets).keyPath).toBe("id");
    expect(tx.objectStore(STORE_NAMES.imageBlobs).keyPath).toBe("key");
    expect(tx.objectStore(STORE_NAMES.settings).keyPath).toBe("key");
    expect(tx.objectStore(STORE_NAMES.conversationDrafts).keyPath).toBe(
      "conversationId",
    );
    expect(tx.objectStore(STORE_NAMES.analyticsEvents).keyPath).toBe("id");
  });

  it("conversations 表的索引包含 updatedAt（DB_VERSION 1→2 迁移后）", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(STORE_NAMES.conversations, "readonly");
    const store = tx.objectStore(STORE_NAMES.conversations);
    expect(store.indexNames.contains("updatedAt")).toBe(true);
    // 旧索引名不应残留（DB_VERSION < 2 时叫 updatedAtMs）
    expect(store.indexNames.contains("updatedAtMs")).toBe(false);
  });

  it("messages 表的索引包含 createdAt（迁移后）", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(STORE_NAMES.messages, "readonly");
    const store = tx.objectStore(STORE_NAMES.messages);
    expect(store.indexNames.contains("createdAt")).toBe(true);
    expect(store.indexNames.contains("createdAtMs")).toBe(false);
  });

  it("imageAssets 表的索引包含 createdAt 与 conversationId", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(STORE_NAMES.imageAssets, "readonly");
    const store = tx.objectStore(STORE_NAMES.imageAssets);
    expect(store.indexNames.contains("createdAt")).toBe(true);
    expect(store.indexNames.contains("conversationId")).toBe(true);
  });

  it("analyticsEvents 表有 occurredAt / eventName / conversationId 三个索引", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(STORE_NAMES.analyticsEvents, "readonly");
    const store = tx.objectStore(STORE_NAMES.analyticsEvents);
    expect(store.indexNames.contains("occurredAt")).toBe(true);
    expect(store.indexNames.contains("eventName")).toBe(true);
    expect(store.indexNames.contains("conversationId")).toBe(true);
  });

  it("conversationDrafts 表有 updatedAtMs 索引", async () => {
    const db = await storage.getDb();
    const tx = db.transaction(STORE_NAMES.conversationDrafts, "readonly");
    const store = tx.objectStore(STORE_NAMES.conversationDrafts);
    expect(store.indexNames.contains("updatedAtMs")).toBe(true);
  });

  it("并发写不丢数据（多个 put 同时进行）", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      storage.put(STORE_NAMES.conversations, {
        id: `c${i}`,
        title: `conv-${i}`,
      }),
    );
    await Promise.all(writes);
    const list = await storage.list<{ id: string }>(
      STORE_NAMES.conversations,
    );
    expect(list).toHaveLength(20);
  });

  it("put 自动从记录提取 keyPath 写入（无需手动指定 key）", async () => {
    // imageBlobs 的 keyPath 是 "key"，不是 "id"
    await storage.put(STORE_NAMES.imageBlobs, {
      key: "blob-1",
      blob: new Blob(["data"]),
    });
    const got = await storage.get<{ key: string; blob: Blob }>(
      STORE_NAMES.imageBlobs,
      "blob-1",
    );
    expect(got?.key).toBe("blob-1");
    expect(got?.blob.size).toBe(4);
  });

  it("saveImageBlob 写入的记录可通过 list imageBlobs 枚举", async () => {
    await storage.saveImageBlob("k1", new Blob(["a"]));
    await storage.saveImageBlob("k2", new Blob(["bb"]));
    const list = await storage.list<{ key: string; blob: Blob }>(
      STORE_NAMES.imageBlobs,
    );
    expect(list).toHaveLength(2);
    const keys = list.map((r) => r.key).sort();
    expect(keys).toEqual(["k1", "k2"]);
  });

  it("readConfig 与 writeConfig 走 __config__ 前缀（与业务 settings 记录隔离）", async () => {
    await storage.writeConfig("companionUrl", "http://x");
    const all = await storage.list<{ key: string; value: unknown }>(
      STORE_NAMES.settings,
    );
    const configRecords = all.filter((r) =>
      String(r.key).startsWith("__config__:"),
    );
    expect(configRecords).toHaveLength(1);
    expect(configRecords[0].key).toBe("__config__:companionUrl");
    expect(configRecords[0].value).toBe("http://x");
  });

  it("backend 字段为 indexeddb", () => {
    expect(storage.backend).toBe("indexeddb");
  });
});

describe("IndexedDbStorage 容量估算（与 storageUsage.ts 行为对齐）", () => {
  let storage: IndexedDbStorage;

  beforeEach(() => {
    storage = new IndexedDbStorage();
  });

  afterEach(async () => {
    for (const store of Object.values(STORE_NAMES)) {
      await storage.clear(store);
    }
  });

  it("estimateStoredBytes 空库 imageBytes 为 0", async () => {
    const result = await storage.estimateStoredBytes();
    expect(result.imageBytes).toBe(0);
  });

  it("estimateStoredBytes 存入元数据后 metadataBytes 增长", async () => {
    const before = await storage.estimateStoredBytes();
    for (let i = 0; i < 10; i++) {
      await storage.put(STORE_NAMES.conversations, {
        id: `c${i}`,
        title: `conversation-title-${i}`,
      });
    }
    const after = await storage.estimateStoredBytes();
    expect(after.metadataBytes).toBeGreaterThan(before.metadataBytes);
  });

  it("estimateStoredBytes 同时计图片字节与元数据字节", async () => {
    await storage.saveImageBlob("img", new Blob(["x".repeat(500)]));
    await storage.put(STORE_NAMES.messages, { id: "m1", conversationId: "c1" });
    const result = await storage.estimateStoredBytes();
    expect(result.imageBytes).toBe(500);
    expect(result.metadataBytes).toBeGreaterThan(0);
  });
});
