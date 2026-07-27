/**
 * NativeStorage 骨架测试 + resolveStorage 分叉测试。
 *
 * CompanionStorage 阶段二已填充真实逻辑（fetch 调 Companion /storage/*），
 * 其契约测试已迁移到 CompanionStorage.test.ts（接入 runStudioStorageContractTests）。
 * 本文件只保留 NativeStorage（阶段四骨架）+ resolveStorage 的分叉逻辑测试。
 */
import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { NativeStorage } from "./NativeStorage";
import { StorageError, STORE_NAMES } from "./types";

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

describe("resolveStorage 分叉逻辑", () => {
  it("无参调用（兜底）返回 IndexedDbStorage", async () => {
    const { resolveStorage } = await import("./resolveStorage");
    const { IndexedDbStorage } = await import("./IndexedDbStorage");
    const storage = resolveStorage();
    expect(storage).toBeInstanceOf(IndexedDbStorage);
    expect(storage.backend).toBe("indexeddb");
  });

  it("connectionMode=direct 返回 IndexedDbStorage", async () => {
    const { resolveStorage } = await import("./resolveStorage");
    const { IndexedDbStorage } = await import("./IndexedDbStorage");
    const storage = resolveStorage({ connectionMode: "direct" });
    expect(storage).toBeInstanceOf(IndexedDbStorage);
  });

  it("connectionMode=localCompanion + getters 返回 CompanionStorage", async () => {
    const { resolveStorage } = await import("./resolveStorage");
    const { CompanionStorage } = await import("./CompanionStorage");
    const storage = resolveStorage({
      connectionMode: "localCompanion",
      getCompanionUrl: () => "http://127.0.0.1:19750",
      getCompanionAccessKey: () => "test-key",
    });
    expect(storage).toBeInstanceOf(CompanionStorage);
    expect(storage.backend).toBe("companion");
  });

  it("connectionMode=localCompanion 但缺 getter 降级 IndexedDbStorage", async () => {
    const { resolveStorage } = await import("./resolveStorage");
    const { IndexedDbStorage } = await import("./IndexedDbStorage");
    const storage = resolveStorage({ connectionMode: "localCompanion" });
    expect(storage).toBeInstanceOf(IndexedDbStorage);
  });

  it("isTauriRuntime() 在非 Tauri 环境返回 false", async () => {
    const { isTauriRuntime } = await import("./resolveStorage");
    expect(isTauriRuntime()).toBe(false);
  });
});
