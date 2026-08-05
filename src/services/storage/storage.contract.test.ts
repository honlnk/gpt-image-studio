/**
 * StudioStorage 契约测试套件（参数化）。
 *
 * 目标：保证「换实现不改接口」。一份测试用例，对每个 StudioStorage 实现跑一遍。
 * 仿 src/types/companionKnownFields.contract.test.ts 的「集合相等 + 防静默漂移」思想，
 * 但测运行时行为而非静态字段。
 *
 * 当前接入的实现：
 * - IndexedDbStorage（真实实现，配 fake-indexeddb）
 * - InMemoryStorage（测试用 mock）
 *
 * 阶段二/四接入时，只需在对应实现的测试文件里加一行 runStudioStorageContractTests(...)，
 * 同一份用例自动覆盖。
 *
 * 语义约束来源：types.ts StudioStorage 接口注释 + evolution-roadmap.md §6.1。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbStorage } from "./IndexedDbStorage";
import { InMemoryStorage } from "./InMemoryStorage";
import { STORE_NAMES, type ImageBlobRecord, type StudioStorage } from "./types";

/**
 * 每个实现提供一个 factory，套件对 factory 跑同一份用例。
 *
 * @param name 实现名（用于 describe 标题）
 * @param createStorage 每个用例前创建全新 storage 实例（保证用例间隔离）
 * @param cleanup 每个用例后清理（如清 indexedDB）
 */
export function runStudioStorageContractTests(
  name: string,
  createStorage: () => Promise<StudioStorage>,
  cleanup?: () => Promise<void>,
): void {
  describe(`StudioStorage contract: ${name}`, () => {
    let storage: StudioStorage;

    beforeEach(async () => {
      storage = await createStorage();
    });

    afterEach(async () => {
      await cleanup?.();
    });

    // ─── 通用 CRUD ───

    it("list 空表返回 []，不抛错", async () => {
      for (const store of Object.values(STORE_NAMES)) {
        await expect(storage.list(store)).resolves.toEqual([]);
      }
    });

    it("get 找不到返回 undefined，不抛错", async () => {
      for (const store of Object.values(STORE_NAMES)) {
        await expect(storage.get(store, "nonexistent-key")).resolves.toBeUndefined();
      }
    });

    it("put 是 upsert，同 key 反复 put 只留最后值", async () => {
      const record = { id: "c1", title: "first" };
      await storage.put(STORE_NAMES.conversations, record);
      await storage.put(STORE_NAMES.conversations, {
        id: "c1",
        title: "second",
      });
      const got = await storage.get(STORE_NAMES.conversations, "c1");
      expect(got).toEqual({ id: "c1", title: "second" });
    });

    it("put 后 get 能取回（往返一致）", async () => {
      const record = { id: "c1", title: "hello", nested: { a: 1 } };
      await storage.put(STORE_NAMES.conversations, record);
      const got = await storage.get<{ id: string; title: string; nested: { a: number } }>(
        STORE_NAMES.conversations,
        "c1",
      );
      expect(got).toEqual(record);
    });

    it("delete 不存在的 key 是 no-op，不抛错", async () => {
      await expect(
        storage.delete(STORE_NAMES.conversations, "nonexistent"),
      ).resolves.toBeUndefined();
    });

    it("delete 后 get 返回 undefined", async () => {
      await storage.put(STORE_NAMES.conversations, { id: "c1", title: "x" });
      await storage.delete(STORE_NAMES.conversations, "c1");
      await expect(
        storage.get(STORE_NAMES.conversations, "c1"),
      ).resolves.toBeUndefined();
    });

    it("clear 只清当前 collection，不影响其它", async () => {
      await storage.put(STORE_NAMES.conversations, { id: "c1", title: "a" });
      await storage.put(STORE_NAMES.messages, {
        id: "m1",
        conversationId: "c1",
      });

      await storage.clear(STORE_NAMES.conversations);

      await expect(storage.list(STORE_NAMES.conversations)).resolves.toEqual([]);
      const messages = await storage.list(STORE_NAMES.messages);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ id: "m1", conversationId: "c1" });
    });

    it("clear 后 list 返回 []", async () => {
      await storage.put(STORE_NAMES.conversations, { id: "c1", title: "a" });
      await storage.clear(STORE_NAMES.conversations);
      await expect(storage.list(STORE_NAMES.conversations)).resolves.toEqual([]);
    });

    it("list 返回多条记录（数量正确）", async () => {
      await storage.put(STORE_NAMES.conversations, { id: "c1", title: "a" });
      await storage.put(STORE_NAMES.conversations, { id: "c2", title: "b" });
      await storage.put(STORE_NAMES.conversations, { id: "c3", title: "c" });
      const list = await storage.list<{ id: string }>(STORE_NAMES.conversations);
      expect(list).toHaveLength(3);
      const ids = list.map((r) => r.id).sort();
      expect(ids).toEqual(["c1", "c2", "c3"]);
    });

    // ─── 分页查询（listPage，T2 修订 / server 模式分页 PR-b） ───
    //
    // listPage 是可选方法，但契约套件只对接实现了它的后端（IndexedDb/InMemory），
    // 这里直接断言存在，未实现会编译期/运行期立刻暴露。

    /** 造 n 条消息，createdAt 逐分钟递增。 */
    async function seedMessages(n: number, conversationId = "c1", keyPrefix = "m") {
      for (let i = 0; i < n; i++) {
        const key = `${keyPrefix}${String(i).padStart(3, "0")}`;
        await storage.put(STORE_NAMES.messages, {
          id: key,
          conversationId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        });
      }
    }

    it("listPage DESC 排序 + 翻页遍历：不重不漏，末页 nextCursor=null，total 正确", async () => {
      await seedMessages(5);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await storage.listPage!<{ id: string }>(STORE_NAMES.messages, {
          before: cursor,
          limit: 2,
        });
        seen.push(...result.data.map((m) => m.id));
        expect(result.total).toBe(5);
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      expect(seen).toEqual(["m004", "m003", "m002", "m001", "m000"]);
    });

    it("listPage conversationId 过滤：只回该会话记录，total 只算过滤后", async () => {
      await seedMessages(3, "c1", "a");
      await seedMessages(2, "c2", "b");
      const result = await storage.listPage!<{ id: string; conversationId: string }>(
        STORE_NAMES.messages,
        { conversationId: "c1", limit: 10 },
      );
      expect(result.data).toHaveLength(3);
      expect(result.data.every((m) => m.conversationId === "c1")).toBe(true);
      expect(result.total).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it("listPage 相同排序值的多条记录跨页不漏不重（主键 tiebreak）", async () => {
      const sameTs = new Date(Date.UTC(2026, 0, 1)).toISOString();
      for (let i = 0; i < 5; i++) {
        await storage.put(STORE_NAMES.messages, {
          id: `m${i}`,
          conversationId: "c1",
          createdAt: sameTs,
        });
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await storage.listPage!<{ id: string }>(STORE_NAMES.messages, {
          before: cursor,
          limit: 2,
        });
        seen.push(...result.data.map((m) => m.id));
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it("listPage conversations 按 updatedAt DESC", async () => {
      for (let i = 0; i < 3; i++) {
        await storage.put(STORE_NAMES.conversations, {
          id: `c${i}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        });
      }
      const result = await storage.listPage!<{ id: string }>(STORE_NAMES.conversations, {
        limit: 2,
      });
      expect(result.data.map((c) => c.id)).toEqual(["c2", "c1"]);
      expect(result.total).toBe(3);
    });

    it("listPage 不支持分页的 store（settings）抛错", async () => {
      await expect(
        storage.listPage!(STORE_NAMES.settings, { limit: 10 }),
      ).rejects.toThrow();
    });

    it("listPage conversations 传 conversationId 抛错", async () => {
      await expect(
        storage.listPage!(STORE_NAMES.conversations, { conversationId: "c1", limit: 10 }),
      ).rejects.toThrow();
    });

    // ─── 图片二进制 ───

    it("saveImageBlob / loadImageBlob 往返一致", async () => {
      const blob = new Blob(["pixel-data"], { type: "image/png" });
      await storage.saveImageBlob("img-1", blob);
      const loaded = await storage.loadImageBlob("img-1");
      expect(loaded).toBeInstanceOf(Blob);
      expect(loaded?.size).toBe(blob.size);
      expect(loaded?.type).toBe(blob.type);
    });

    it("loadImageBlob 找不到返回 undefined，不抛错", async () => {
      await expect(storage.loadImageBlob("nonexistent")).resolves.toBeUndefined();
    });

    it("deleteImageBlob 不存在的 key 是 no-op", async () => {
      await expect(storage.deleteImageBlob("nonexistent")).resolves.toBeUndefined();
    });

    it("deleteImageBlob 后 loadImageBlob 返回 undefined", async () => {
      await storage.saveImageBlob("img-1", new Blob(["x"]));
      await storage.deleteImageBlob("img-1");
      await expect(storage.loadImageBlob("img-1")).resolves.toBeUndefined();
    });

    it("saveImageBlob 同 key 覆盖（upsert）", async () => {
      await storage.saveImageBlob("img-1", new Blob(["old"]));
      await storage.saveImageBlob("img-1", new Blob(["new-data"]));
      const loaded = await storage.loadImageBlob("img-1");
      expect(loaded?.size).toBe(8); // "new-data" length
    });

    it("空 blob（size=0）往返一致", async () => {
      await storage.saveImageBlob("img-empty", new Blob([]));
      const loaded = await storage.loadImageBlob("img-empty");
      expect(loaded?.size).toBe(0);
    });

    it("大 blob（1MB+）往返一致", async () => {
      const payload = new Uint8Array(1024 * 1024 + 13); // 1MB+ 略大于对齐
      payload.fill(42);
      const blob = new Blob([payload]);
      await storage.saveImageBlob("img-big", blob);
      const loaded = await storage.loadImageBlob("img-big");
      expect(loaded?.size).toBe(blob.size);
    });

    // ─── 配置（readConfig / writeConfig） ───

    it("readConfig 找不到返回 undefined", async () => {
      await expect(storage.readConfig("nonexistent")).resolves.toBeUndefined();
    });

    it("writeConfig / readConfig 往返一致", async () => {
      await storage.writeConfig("companionUrl", "http://127.0.0.1:19750");
      const got = await storage.readConfig<string>("companionUrl");
      expect(got).toBe("http://127.0.0.1:19750");
    });

    it("writeConfig 同 key 覆盖", async () => {
      await storage.writeConfig("companionUrl", "http://old");
      await storage.writeConfig("companionUrl", "http://new");
      const got = await storage.readConfig<string>("companionUrl");
      expect(got).toBe("http://new");
    });

    it("readConfig/writeConfig 与业务 settings 记录隔离（config key 不污染 app 记录）", async () => {
      // 写一条业务 settings 记录（key="app"，模拟 settings.ts 的 SETTINGS_KEY）
      await storage.put(STORE_NAMES.settings, { key: "app", value: { apiKey: "sk-xxx" } });
      // 写一条 config 记录
      await storage.writeConfig("companionUrl", "http://127.0.0.1:19750");

      // 业务记录不被 config 污染
      const businessRecord = await storage.get<{ key: string; value: { apiKey: string } }>(
        STORE_NAMES.settings,
        "app",
      );
      expect(businessRecord?.value.apiKey).toBe("sk-xxx");

      // config 记录独立可读
      const configValue = await storage.readConfig<string>("companionUrl");
      expect(configValue).toBe("http://127.0.0.1:19750");

      // settings 表现在应有 2 条（app + __config__:companionUrl）
      const allSettings = await storage.list(STORE_NAMES.settings);
      expect(allSettings).toHaveLength(2);
    });

    it("writeConfig 支持复杂对象值", async () => {
      const complex = { nested: { a: [1, 2, 3] }, flag: true };
      await storage.writeConfig("complex", complex);
      const got = await storage.readConfig<typeof complex>("complex");
      expect(got).toEqual(complex);
    });

    // ─── 容量估算 ───

    it("estimateStoredBytes 空库返回 { imageBytes: 0, metadataBytes: 0 或更小值 }", async () => {
      const result = await storage.estimateStoredBytes();
      expect(result.imageBytes).toBe(0);
      // metadataBytes 在空库时可能非 0（空数组序列化也有字节），但不应负数
      expect(result.metadataBytes).toBeGreaterThanOrEqual(0);
    });

    it("estimateStoredBytes 存入图片后 imageBytes 增长", async () => {
      const before = await storage.estimateStoredBytes();
      await storage.saveImageBlob("img-1", new Blob(["x".repeat(1000)]));
      const after = await storage.estimateStoredBytes();
      expect(after.imageBytes - before.imageBytes).toBeGreaterThanOrEqual(1000);
    });

    it("estimateStoredBytes 返回值的 imageBytes 与实际 blob 大小一致", async () => {
      const blob = new Blob(["x".repeat(2048)]);
      await storage.saveImageBlob("img-1", blob);
      const result = await storage.estimateStoredBytes();
      expect(result.imageBytes).toBe(blob.size);
    });

    it("estimateQuota 是可选方法，调用不抛错（无 navigator.storage 时返回空对象）", async () => {
      if (storage.estimateQuota) {
        const result = await storage.estimateQuota();
        // fake-indexeddb 不提供 navigator.storage，应返回 {} 或带 usage/quota 的对象
        expect(typeof result).toBe("object");
      }
    });

    // ─── backend 标识 ───

    it("backend 字段是合法的 StorageBackend 值", () => {
      expect(["indexeddb", "companion", "native"]).toContain(storage.backend);
    });
  });
}

// ─── 各实现接入同一份契约用例 ───

runStudioStorageContractTests(
  "IndexedDbStorage",
  async () => new IndexedDbStorage(),
  async () => {
    // 清理 fake-indexeddb 的全部 store，保证用例间隔离
    const db = new IndexedDbStorage();
    for (const store of Object.values(STORE_NAMES)) {
      await db.clear(store);
    }
  },
);

runStudioStorageContractTests(
  "InMemoryStorage",
  async () => new InMemoryStorage(),
);

// ─── ImageBlobRecord 类型一致性（防三处定义漂移，PR6 收敛后此测试简化） ───

describe("ImageBlobRecord 类型一致性（PR1 阶段性保护）", () => {
  it("ImageBlobRecord 结构为 { key: string; blob: Blob }", () => {
    const record: ImageBlobRecord = { key: "k1", blob: new Blob(["x"]) };
    expect(record.key).toBe("k1");
    expect(record.blob).toBeInstanceOf(Blob);
  });
});
