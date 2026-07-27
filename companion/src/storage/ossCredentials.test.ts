import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ossCredentials.ts 测试：OSS 凭据文件读写 + 脱敏视图。
 * 通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-osscred-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadModules() {
  return await import("./ossCredentials.js");
}

const sampleCreds = {
  endpoint: "oss-cn-hangzhou.aliyuncs.com",
  bucket: "my-bucket",
  accessKeyId: "LTAI5tXXXXXXXXXXXXXXX",
  accessKeySecret: "YYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
};

describe("loadOssCredentials", () => {
  it("未配置返回 undefined", async () => {
    const { loadOssCredentials } = await loadModules();
    expect(loadOssCredentials()).toBeUndefined();
  });

  it("损坏文件返回 undefined（不抛错）", async () => {
    const { saveOssCredentials, loadOssCredentials } = await loadModules();
    // 写一个损坏文件
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tempDir, "oss-credentials.json"), "{broken json");
    expect(loadOssCredentials()).toBeUndefined();
  });

  it("结构不完整返回 undefined", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(tempDir, "oss-credentials.json"),
      JSON.stringify({ endpoint: "e" }), // 缺 bucket/AK/SK
    );
    const { loadOssCredentials } = await loadModules();
    expect(loadOssCredentials()).toBeUndefined();
  });
});

describe("saveOssCredentials", () => {
  it("写入文件，权限 0600", async () => {
    const { saveOssCredentials } = await loadModules();
    saveOssCredentials(sampleCreds);
    const file = join(tempDir, "oss-credentials.json");
    expect(existsSync(file)).toBe(true);
    const stat = statSync(file);
    expect((stat.mode & 0o777)).toBe(0o600);
  });

  it("saveOssCredentials + loadOssCredentials 往返一致（含 configuredAt）", async () => {
    const { saveOssCredentials, loadOssCredentials } = await loadModules();
    saveOssCredentials(sampleCreds);
    const loaded = loadOssCredentials();
    expect(loaded).toBeDefined();
    expect(loaded!.endpoint).toBe(sampleCreds.endpoint);
    expect(loaded!.bucket).toBe(sampleCreds.bucket);
    expect(loaded!.accessKeyId).toBe(sampleCreds.accessKeyId);
    expect(loaded!.accessKeySecret).toBe(sampleCreds.accessKeySecret);
    expect(loaded!.configuredAt).toBeDefined();
  });
});

describe("clearOssCredentials", () => {
  it("删除文件", async () => {
    const { saveOssCredentials, clearOssCredentials, loadOssCredentials } =
      await loadModules();
    saveOssCredentials(sampleCreds);
    clearOssCredentials();
    expect(loadOssCredentials()).toBeUndefined();
  });

  it("不存在时 no-op", async () => {
    const { clearOssCredentials } = await loadModules();
    expect(() => clearOssCredentials()).not.toThrow();
  });
});

describe("toOssCredentialsView", () => {
  it("剥离 accessKeySecret，accessKeyId 脱敏", async () => {
    const { saveOssCredentials, loadOssCredentials, toOssCredentialsView } =
      await loadModules();
    saveOssCredentials(sampleCreds);
    const creds = loadOssCredentials()!;
    const view = toOssCredentialsView(creds);
    expect(view.endpoint).toBe(sampleCreds.endpoint);
    expect(view.bucket).toBe(sampleCreds.bucket);
    expect(view.configured).toBe(true);
    // 不含 secret
    expect(JSON.stringify(view)).not.toContain(sampleCreds.accessKeySecret);
    // accessKeyId 脱敏（首4 + *** + 末4）
    expect(view.accessKeyIdMasked).toMatch(/\w{4}\*\*\*\w{4}/);
  });

  it("短 accessKeyId 全脱敏", async () => {
    const { toOssCredentialsView } = await loadModules();
    const view = toOssCredentialsView({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "abc",
      accessKeySecret: "s",
    });
    expect(view.accessKeyIdMasked).toBe("***");
  });
});
