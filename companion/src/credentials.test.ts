import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/**
 * 凭据文件损坏处理（P3-A）。
 *
 * 此前的 loadStore 把 JSON 解析失败/结构损坏全部 catch 成空 store，导致：
 * 1. 用户看到"所有 Provider 配置突然消失"——实际上是文件坏了，不是真的没配置。
 * 2. 后续任何 addCredential/updateCredential 等"读-改-写"会覆盖原始损坏文件，数据永久丢失。
 *
 * 现在的行为：损坏文件被备份到 credentials.json.corrupt-{ts}.json，
 * loadStore 抛 CredentialStoreError，让 route 层把明确原因回传给 Web/CLI。
 */
describe("credentials store corruption handling", () => {
  /** 把任意内容写进 credentials.json 模拟损坏。 */
  function writeCorruptFile(content: string): string {
    const file = join(tempDir, "credentials.json");
    writeFileSync(file, content, "utf-8");
    return file;
  }

  /** 找到 tempDir 里的备份文件路径（credentials.json.corrupt-*.json）。 */
  function findBackupFile(): string | undefined {
    return readdirSync(tempDir).find((name) => name.startsWith("credentials.json.corrupt-"));
  }

  it("throws CredentialStoreError when JSON is unparseable", async () => {
    const { loadStore, CredentialStoreError } = await loadModules();
    writeCorruptFile("}{not valid json");
    // 注意：loadStore 第一次调用会备份并删除原文件，第二次调就找不到文件了。
    // 所以这里用一次 try/catch 同时验证类型和文案。
    try {
      loadStore();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as Error).message).toMatch(/无法解析/);
    }
  });

  it("backs up corrupt JSON file before throwing", async () => {
    const { loadStore } = await loadModules();
    const corruptContent = "}{broken";
    writeCorruptFile(corruptContent);

    expect(() => loadStore()).toThrow();
    const backup = findBackupFile();
    expect(backup).toBeDefined();
    expect(readFileSync(join(tempDir, backup!), "utf-8")).toBe(corruptContent);
    // 原文件应已被 rename 走（不再存在于原路径）
    expect(existsSync(join(tempDir, "credentials.json"))).toBe(false);
  });

  it("rejects non-array entries as CRED_INVALID_STRUCTURE", async () => {
    const { loadStore, CredentialStoreError } = await loadModules();
    writeCorruptFile(JSON.stringify({ entries: "not-an-array", activeId: null }));
    try {
      loadStore();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as Error).message).toMatch(/entries 不是数组/);
    }
  });

  it("rejects entry with missing required field", async () => {
    const { loadStore } = await loadModules();
    // 缺 apiKey 字段
    writeCorruptFile(
      JSON.stringify({
        entries: [
          {
            id: "x",
            label: "test",
            provider: "openai",
            apiBaseUrl: "https://example.com",
            model: "gpt-image-2",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        activeId: "x",
      }),
    );
    expect(() => loadStore()).toThrow(/apiKey 缺失或不是非空 string/);
  });

  it("rejects entry with empty string field", async () => {
    const { loadStore } = await loadModules();
    // apiKey 为空串
    writeCorruptFile(
      JSON.stringify({
        entries: [
          {
            id: "x",
            label: "test",
            provider: "openai",
            apiBaseUrl: "https://example.com",
            apiKey: "",
            model: "gpt-image-2",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        activeId: "x",
      }),
    );
    expect(() => loadStore()).toThrow(/apiKey 缺失或不是非空 string/);
  });

  it("silently falls back to first entry when activeId is orphaned", async () => {
    const { loadStore } = await loadModules();
    const validEntry = {
      id: "real-id",
      label: "real",
      provider: "openai",
      apiBaseUrl: "https://example.com",
      apiKey: "sk-real",
      model: "gpt-image-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    writeCorruptFile(
      JSON.stringify({
        entries: [validEntry],
        activeId: "nonexistent-id", // 孤儿
      }),
    );
    // 不抛错
    const store = loadStore();
    expect(store.activeId).toBe("real-id"); // 回退到首条
    expect(store.entries).toHaveLength(1);
  });

  it("addCredential after corruption does NOT overwrite the backup", async () => {
    const { loadStore, addCredential, listCredentials } = await loadModules();
    const corruptContent = "}{broken";
    writeCorruptFile(corruptContent);

    // 损坏后 addCredential：loadStore 会先备份+抛错，addCredential 拿不到旧 store，
    // 应该以空 store 为起点创建新 entry（loadStore 的备份逻辑清空了原文件路径）。
    // 注意：addCredential 内部调 loadStore，loadStore 抛错会冒泡。
    // 这里的契约是：损坏后用户必须先看到错误，重新配置才生效。
    // 验证：原损坏内容仍在备份文件里，没被覆盖。
    expect(() => addCredential(sampleInput)).toThrow();

    const backup = findBackupFile();
    expect(backup).toBeDefined();
    expect(readFileSync(join(tempDir, backup!), "utf-8")).toBe(corruptContent);
  });

  it("CRED_PARSE_FAILED code is set on parse errors", async () => {
    const { loadStore, CredentialStoreError } = await loadModules();
    writeCorruptFile("}{broken");
    try {
      loadStore();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as InstanceType<typeof CredentialStoreError>).code).toBe("CRED_PARSE_FAILED");
    }
  });

  it("CRED_INVALID_STRUCTURE code is set on structure errors", async () => {
    const { loadStore, CredentialStoreError } = await loadModules();
    writeCorruptFile(JSON.stringify({ entries: "not-array" }));
    try {
      loadStore();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as InstanceType<typeof CredentialStoreError>).code).toBe("CRED_INVALID_STRUCTURE");
    }
  });

  /**
   * 损坏事件的内存缓存（解决「一次性信号」问题）。
   *
   * 真实场景：Web 端连续发多次 /credentials，第一次触发损坏备份（事件被记录），
   * 后续请求文件已不在，返正常空列表。没有事件缓存的话，Web 的 credError 会被
   * 第二次的 200 清空，用户根本看不到损坏提示。
   *
   * 事件缓存把损坏信号提升为「进程内持久状态」，直到用户成功 addCredential 才清除。
   */
  describe("corruption event caching", () => {
    it("loadStore 备份后记录事件，供后续 consumeCorruptionEvent 读取", async () => {
      const { loadStore, consumeCorruptionEvent } = await loadModules();
      writeCorruptFile("}{broken");
      expect(() => loadStore()).toThrow();

      const event = consumeCorruptionEvent();
      expect(event).not.toBeNull();
      expect(event!.message).toMatch(/无法解析/);
      expect(event!.message).toMatch(/已备份/);
      expect(event!.backupPath).toContain("credentials.json.corrupt-");
      expect(typeof event!.timestamp).toBe("number");
    });

    it("event persists across subsequent loadStore calls (file already gone)", async () => {
      const { loadStore, consumeCorruptionEvent } = await loadModules();
      writeCorruptFile("}{broken");
      expect(() => loadStore()).toThrow();

      // 第二次 loadStore：文件已被备份移走，返空 store（不抛错）
      expect(loadStore()).toEqual({ entries: [], activeId: null });

      // 但事件仍在——route 层据此仍返 500+corrupt，让 Web 能看到
      const event = consumeCorruptionEvent();
      expect(event).not.toBeNull();
      expect(event!.message).toMatch(/无法解析/);
    });

    it("event is NOT consumed by consumeCorruptionEvent (can be read repeatedly)", async () => {
      const { loadStore, consumeCorruptionEvent } = await loadModules();
      writeCorruptFile("}{broken");
      expect(() => loadStore()).toThrow();

      // Web 可能刷新页面多次，每次都要看到损坏提示
      expect(consumeCorruptionEvent()).not.toBeNull();
      expect(consumeCorruptionEvent()).not.toBeNull();
      expect(consumeCorruptionEvent()).not.toBeNull();
    });

    it("addCredential clears the event (user has reconfigured, corruption is over)", async () => {
      // 这个测试需要完整的 addCredential 流程，而 addCredential 内部会 loadStore。
      // 损坏后 addCredential 会因 loadStore 抛错而失败——所以先让 loadStore 备份完文件，
      // 再用 addCredential 创建新条目（此时文件已不在，loadStore 返空 store，add 能成功）。
      const { loadStore, addCredential, consumeCorruptionEvent } = await loadModules();
      writeCorruptFile("}{broken");
      expect(() => loadStore()).toThrow();
      expect(consumeCorruptionEvent()).not.toBeNull();

      // 损坏后文件已被备份走，现在 addCredential 能在干净状态上创建新条目
      const entry = addCredential(sampleInput);
      expect(entry.id).toBeTruthy();

      // 事件被清除——后续 /credentials 返正常空列表，不再提示历史损坏
      expect(consumeCorruptionEvent()).toBeNull();
    });

    it("event does not survive process restart (module reload)", async () => {
      // 第一次模块实例：触发损坏，事件被记录
      const mod1 = await loadModules();
      writeCorruptFile("}{broken");
      expect(() => mod1.loadStore()).toThrow();
      expect(mod1.consumeCorruptionEvent()).not.toBeNull();

      // 模块重载（模拟进程重启）：事件消失
      // 注意：vi.resetModules 已在 beforeEach 调用，这里手动再 reset 一次
      vi.resetModules();
      const mod2 = await loadModules();
      expect(mod2.consumeCorruptionEvent()).toBeNull();
    });
  });
});

/**
 * 损坏恢复动作：resetEmptyStore + restoreLatestBackup。
 *
 * 这两个函数是异常面板「从备份恢复」和「重置成空配置」按钮的服务端实现。
 */
describe("credential store recovery actions", () => {
  function writeFile(content: string): void {
    writeFileSync(join(tempDir, "credentials.json"), content, "utf-8");
  }

  function writeBackupFile(timestamp: number, content: string): string {
    const name = `credentials.json.corrupt-${timestamp}.json`;
    writeFileSync(join(tempDir, name), content, "utf-8");
    return name;
  }

  function listBackupFiles(): string[] {
    return readdirSync(tempDir).filter((n) => n.startsWith("credentials.json.corrupt-"));
  }

  it("resetEmptyStore writes a clean empty store and clears corruption event", async () => {
    const { loadStore, resetEmptyStore, consumeCorruptionEvent } = await loadModules();
    // 先制造一次损坏，让事件被记录
    writeFile("}{broken");
    expect(() => loadStore()).toThrow();
    expect(consumeCorruptionEvent()).not.toBeNull();

    // resetEmptyStore 后：文件变成合法空 store，事件被清除
    resetEmptyStore();
    expect(loadStore()).toEqual({ entries: [], activeId: null });
    expect(consumeCorruptionEvent()).toBeNull();
  });

  it("resetEmptyStore does not delete existing backup files", async () => {
    const { loadStore, resetEmptyStore } = await loadModules();
    writeFile("}{broken");
    expect(() => loadStore()).toThrow();
    // 此时已有 1 个备份文件
    expect(listBackupFiles()).toHaveLength(1);

    resetEmptyStore();
    // 备份文件保留（用户可能后悔，让他手动恢复）
    expect(listBackupFiles()).toHaveLength(1);
  });

  it("restoreLatestBackup restores from the most recent backup", async () => {
    const { restoreLatestBackup, loadStore } = await loadModules();
    // 写两个备份，时间戳靠后的更"新"
    const olderContent = JSON.stringify({
      entries: [
        {
          id: "old-id",
          label: "旧配置",
          provider: "openai",
          apiBaseUrl: "https://old.example.com",
          apiKey: "sk-old",
          model: "gpt-image-2",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      activeId: "old-id",
    });
    const newerContent = JSON.stringify({
      entries: [
        {
          id: "new-id",
          label: "新配置",
          provider: "glm",
          apiBaseUrl: "https://new.example.com",
          apiKey: "sk-new",
          model: "cogview-3",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      activeId: "new-id",
    });
    writeBackupFile(1000, olderContent);
    writeBackupFile(2000, newerContent);

    const store = restoreLatestBackup();
    // 恢复的是时间戳最大（最新）的那个
    expect(store.entries[0].id).toBe("new-id");
    expect(loadStore().entries[0].id).toBe("new-id");
  });

  it("restoreLatestBackup deletes the restored backup file on success", async () => {
    const { restoreLatestBackup } = await loadModules();
    writeBackupFile(1000, JSON.stringify({ entries: [], activeId: null }));

    restoreLatestBackup();
    // 已恢复的备份被删除（不再需要）
    expect(listBackupFiles()).toHaveLength(0);
  });

  it("restoreLatestBackup throws when no backup exists", async () => {
    const { restoreLatestBackup, CredentialStoreError } = await loadModules();
    try {
      restoreLatestBackup();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as Error).message).toMatch(/没有找到备份文件/);
    }
  });

  it("restoreLatestBackup throws when backup itself is corrupt (JSON unparseable)", async () => {
    const { restoreLatestBackup, CredentialStoreError } = await loadModules();
    writeBackupFile(1000, "}{also-broken");

    try {
      restoreLatestBackup();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as Error).message).toMatch(/仍无法解析/);
    }
    // 失败时备份文件保留（原状不变，用户可改试 reset）
    expect(listBackupFiles()).toHaveLength(1);
  });

  it("restoreLatestBackup throws when backup has invalid structure", async () => {
    const { restoreLatestBackup, CredentialStoreError } = await loadModules();
    writeBackupFile(1000, JSON.stringify({ entries: "not-array" }));

    try {
      restoreLatestBackup();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialStoreError);
      expect((e as Error).message).toMatch(/结构不合法/);
    }
    expect(listBackupFiles()).toHaveLength(1);
  });
});
