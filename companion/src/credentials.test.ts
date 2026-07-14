import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * credentials.ts 的单元测试：store CRUD + 激活联动逻辑。
 *
 * 每个用例用独立的临时目录（通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离），
 * 不碰真实的 ~/.gpt-image-studio。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-cred-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  // 动态 import 让 env 生效
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

// vi 需要在 import 前可见，但 credentials.ts 读 env 在调用时（非 import 时），
// 所以用动态 import 保证每个测试拿到干净的模块状态。
async function loadModules() {
  return await import("./credentials.js");
}

const sampleInput = {
  provider: "doubao",
  apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images",
  apiKey: "ark-test-key",
  model: "doubao-seedream-5-0",
};

describe("credentials store CRUD", () => {
  it("starts empty", async () => {
    const { listCredentials, getActiveCredential } = await loadModules();
    expect(listCredentials()).toEqual({ entries: [], activeId: null });
    expect(getActiveCredential()).toBeNull();
  });

  it("first add auto-activates", async () => {
    const { addCredential, listCredentials, getActiveCredential } = await loadModules();
    const entry = addCredential(sampleInput);

    expect(entry.id).toBeTruthy();
    expect(entry.provider).toBe("doubao");
    const store = listCredentials();
    expect(store.entries).toHaveLength(1);
    expect(store.activeId).toBe(entry.id);
    expect(getActiveCredential()?.id).toBe(entry.id);
  });

  it("second add does not steal active", async () => {
    const { addCredential, activateCredential, listCredentials } = await loadModules();
    const first = addCredential(sampleInput);
    const second = addCredential({ ...sampleInput, provider: "glm" });

    const store = listCredentials();
    expect(store.entries).toHaveLength(2);
    expect(store.activeId).toBe(first.id); // 仍是第一条

    // 手动激活第二条
    expect(activateCredential(second.id)).toBe(true);
    expect(listCredentials().activeId).toBe(second.id);
  });

  it("update modifies fields", async () => {
    const { addCredential, updateCredential } = await loadModules();
    const entry = addCredential(sampleInput);

    const updated = updateCredential(entry.id, {
      ...sampleInput,
      label: "豆包生产",
      apiKey: "ark-new-key",
    });
    expect(updated).not.toBeNull();
    expect(updated!.label).toBe("豆包生产");
    expect(updated!.apiKey).toBe("ark-new-key");
    expect(updated!.updatedAt).toBeTruthy();
  });

  it("update returns null for unknown id", async () => {
    const { updateCredential } = await loadModules();
    expect(updateCredential("nonexistent", sampleInput)).toBeNull();
  });

  it("remove deletes entry; removing active falls back to first remaining", async () => {
    const { addCredential, removeCredential, listCredentials, getActiveCredential } = await loadModules();
    const first = addCredential(sampleInput);
    const second = addCredential({ ...sampleInput, provider: "glm" });
    addCredential({ ...sampleInput, provider: "qwen" });

    // 激活第二条，然后删除它 → 应回退到剩余首条
    expect(removeCredential(second.id)).toBe(true);
    const store = listCredentials();
    expect(store.entries).toHaveLength(2);
    expect(store.activeId).toBe(first.id);
    expect(getActiveCredential()?.id).toBe(first.id);
  });

  it("remove returns false for unknown id", async () => {
    const { removeCredential } = await loadModules();
    expect(removeCredential("nonexistent")).toBe(false);
  });

  it("removing the last entry clears activeId", async () => {
    const { addCredential, removeCredential, listCredentials } = await loadModules();
    const entry = addCredential(sampleInput);
    removeCredential(entry.id);
    const store = listCredentials();
    expect(store.entries).toHaveLength(0);
    expect(store.activeId).toBeNull();
  });

  it("activate returns false for unknown id", async () => {
    const { activateCredential } = await loadModules();
    expect(activateCredential("nonexistent")).toBe(false);
  });

  it("persists to disk as JSON with entries + activeId", async () => {
    const { addCredential } = await loadModules();
    addCredential(sampleInput);
    const file = join(tempDir, "credentials.json");
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    expect(raw.entries).toHaveLength(1);
    expect(raw.activeId).toBe(raw.entries[0].id);
  });

  it("empty label gets auto-generated default", async () => {
    const { addCredential } = await loadModules();
    const entry = addCredential({ ...sampleInput, label: undefined });
    expect(entry.label).toBe("配置 1");

    const second = addCredential({ ...sampleInput, label: "  ", provider: "glm" });
    expect(second.label).toBe("配置 2");
  });

  it("respects explicit label", async () => {
    const { addCredential } = await loadModules();
    const entry = addCredential({ ...sampleInput, label: "我的豆包" });
    expect(entry.label).toBe("我的豆包");
  });
});
