/**
 * CompanionStorage / NativeStorage 骨架测试。
 *
 * 阶段一两个实现都是骨架（所有方法抛 BACKEND_UNAVAILABLE）。
 * 本测试断言骨架行为正确，避免误用。
 *
 * 阶段二/四填充真实逻辑后，这两个文件会接入 storage.contract.test.ts
 * 跑完整契约套件，本文件的 BACKEND_UNAVAILABLE 断言届时移除。
 */
import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { CompanionStorage } from "./CompanionStorage";
import { NativeStorage } from "./NativeStorage";
import { StorageError, STORE_NAMES } from "./types";

describe("CompanionStorage 骨架", () => {
  const storage = new CompanionStorage();

  it("backend 标识为 companion", () => {
    expect(storage.backend).toBe("companion");
  });

  it.each([
    ["list", () => storage.list(STORE_NAMES.conversations)],
    ["get", () => storage.get(STORE_NAMES.conversations, "x")],
    ["put", () => storage.put(STORE_NAMES.conversations, { id: "x" })],
    ["delete", () => storage.delete(STORE_NAMES.conversations, "x")],
    ["clear", () => storage.clear(STORE_NAMES.conversations)],
    ["saveImageBlob", () => storage.saveImageBlob("x", new Blob([]))],
    ["loadImageBlob", () => storage.loadImageBlob("x")],
    ["deleteImageBlob", () => storage.deleteImageBlob("x")],
    ["readConfig", () => storage.readConfig("x")],
    ["writeConfig", () => storage.writeConfig("x", "v")],
    ["estimateStoredBytes", () => storage.estimateStoredBytes()],
  ])("%s 抛 BACKEND_UNAVAILABLE", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      name: "StorageError",
      code: "BACKEND_UNAVAILABLE",
    });
  });

  it("拒绝错误是 StorageError 实例", async () => {
    try {
      await storage.list(STORE_NAMES.conversations);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).code).toBe("BACKEND_UNAVAILABLE");
    }
  });
});

describe("NativeStorage 骨架", () => {
  const storage = new NativeStorage();

  it("backend 标识为 native", () => {
    expect(storage.backend).toBe("native");
  });

  it.each([
    ["list", () => storage.list(STORE_NAMES.conversations)],
    ["get", () => storage.get(STORE_NAMES.conversations, "x")],
    ["put", () => storage.put(STORE_NAMES.conversations, { id: "x" })],
    ["delete", () => storage.delete(STORE_NAMES.conversations, "x")],
    ["clear", () => storage.clear(STORE_NAMES.conversations)],
    ["saveImageBlob", () => storage.saveImageBlob("x", new Blob([]))],
    ["loadImageBlob", () => storage.loadImageBlob("x")],
    ["deleteImageBlob", () => storage.deleteImageBlob("x")],
    ["readConfig", () => storage.readConfig("x")],
    ["writeConfig", () => storage.writeConfig("x", "v")],
    ["estimateStoredBytes", () => storage.estimateStoredBytes()],
  ])("%s 抛 BACKEND_UNAVAILABLE", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({
      name: "StorageError",
      code: "BACKEND_UNAVAILABLE",
    });
  });
});

describe("resolveStorage 阶段一恒返回 IndexedDbStorage", () => {
  it("resolveStorage() 返回 IndexedDbStorage 实例", async () => {
    const { resolveStorage } = await import("./resolveStorage");
    const { IndexedDbStorage } = await import("./IndexedDbStorage");
    const storage = resolveStorage();
    expect(storage).toBeInstanceOf(IndexedDbStorage);
    expect(storage.backend).toBe("indexeddb");
  });

  it("isTauriRuntime() 在非 Tauri 环境返回 false", async () => {
    const { isTauriRuntime } = await import("./resolveStorage");
    expect(isTauriRuntime()).toBe(false);
  });
});
