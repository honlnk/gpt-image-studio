import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * credentials route 级集成测试：Fastify injection 模拟真实 HTTP，
 * 用独立 tempDir（通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离）让 loadStore 真实读写文件，
 * 不 mock credentials 模块——验证「损坏文件 → 500+corrupt 响应」的完整链路。
 *
 * 不起真实端口、不走 auth 中间件（credentials route 自带 loopbackGuard，
 * app.inject 默认无 Origin 头，loopbackGuard 视为本机直连放行）。
 */

let tempDir: string;
let credentialsRoutes: typeof import("./credentials.js").credentialsRoutes;
let authRoutes: typeof import("./auth.js").authRoutes;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-cred-route-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function makeCredentialsApp(): Promise<FastifyInstance> {
  credentialsRoutes = (await import("./credentials.js")).credentialsRoutes;
  const app: FastifyInstance = Fastify();
  await app.register(credentialsRoutes);
  return app;
}

async function makeAuthApp(): Promise<FastifyInstance> {
  authRoutes = (await import("./auth.js")).authRoutes;
  const app: FastifyInstance = Fastify();
  await app.register(authRoutes);
  return app;
}

function writeCorruptFile(content: string): void {
  writeFileSync(join(tempDir, "credentials.json"), content, "utf-8");
}

function findBackupFile(): string | undefined {
  return readdirSync(tempDir).find((name) => name.startsWith("credentials.json.corrupt-"));
}

describe("/credentials route corruption handling", () => {
  it("returns 500 + corrupt:true + readable error when JSON is corrupt", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile("}{broken json");

    const res = await app.inject({ method: "GET", url: "/credentials" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.corrupt).toBe(true);
    expect(body.error).toMatch(/无法解析/);
    expect(body.error).toMatch(/已备份/);
    // 原损坏文件被备份
    expect(findBackupFile()).toBeDefined();
    await app.close();
  });

  it("returns 500 + corrupt:true when structure is invalid", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile(JSON.stringify({ entries: "not-array" }));

    const res = await app.inject({ method: "GET", url: "/credentials" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.corrupt).toBe(true);
    expect(body.error).toMatch(/结构不合法/);
    await app.close();
  });

  it("POST /credentials returns 500 + corrupt:true on corrupt store", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile("}{broken");

    const res = await app.inject({
      method: "POST",
      url: "/credentials",
      headers: { "content-type": "application/json" },
      payload: {
        apiBaseUrl: "https://api.example.com",
        apiKey: "sk-test",
      },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.corrupt).toBe(true);
    await app.close();
  });

  /**
   * 损坏事件持久性：Web 端连续刷新页面会发多次 GET /credentials，
   * 每次都应看到损坏提示（500+corrupt），直到用户重新添加凭据。
   */
  it("GET /credentials keeps returning 500+corrupt across repeated requests after corruption", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile("}{broken");

    // 模拟 Web 端连续 3 次刷新（每次都会 GET /credentials）
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/credentials" });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.corrupt).toBe(true);
      expect(body.error).toMatch(/无法解析/);
    }
    await app.close();
  });

  /**
   * 恢复闭环：损坏 → 多次看到提示 → addCredential → 后续 GET 返正常空列表。
   */
  it("GET /credentials returns to normal 200 after addCredential recovers from corruption", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile("}{broken");

    // 损坏后第一次 GET：500+corrupt
    const corruptRes = await app.inject({ method: "GET", url: "/credentials" });
    expect(corruptRes.statusCode).toBe(500);
    expect(corruptRes.json().corrupt).toBe(true);

    // 用户看到提示后重新添加凭据（文件已被备份走，addCredential 在干净状态创建）
    const addRes = await app.inject({
      method: "POST",
      url: "/credentials",
      headers: { "content-type": "application/json" },
      payload: {
        label: "恢复后的新配置",
        provider: "openai",
        apiBaseUrl: "https://api.example.com",
        apiKey: "sk-recovered",
        model: "gpt-image-2",
      },
    });
    expect(addRes.statusCode).toBe(200);
    expect(addRes.json().ok).toBe(true);

    // 后续 GET：返正常列表（不再 corrupt）
    const afterRes = await app.inject({ method: "GET", url: "/credentials" });
    expect(afterRes.statusCode).toBe(200);
    const afterBody = afterRes.json();
    expect(afterBody.corrupt).toBeUndefined();
    expect(afterBody.entries).toHaveLength(1);
    expect(afterBody.entries[0].label).toBe("恢复后的新配置");
    await app.close();
  });
});

describe("/auth/status corruption handling", () => {
  it("returns 200 + ready:false when credentials corrupt (degrades gracefully)", async () => {
    const app = await makeAuthApp();
    writeCorruptFile("}{broken");

    const res = await app.inject({ method: "GET", url: "/auth/status" });
    // /auth/status 不主动探测损坏（那是 /credentials 的职责）；
    // getActiveCredential 内部 catch CredentialStoreError 返 null，
    // 所以这里走「无凭据」正常分支：返 200 + ready:false + OpenAI 默认能力。
    // 损坏原因由 /credentials 的 500+corrupt 通道展示给用户。
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.corrupt).toBeUndefined();
    await app.close();
  });

  it("returns normal status when credentials healthy", async () => {
    const app = await makeAuthApp();
    // 写一个合法的空 store
    writeCorruptFile(JSON.stringify({ entries: [], activeId: null }));

    const res = await app.inject({ method: "GET", url: "/auth/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ready).toBe(false);
    await app.close();
  });
});

describe("/credentials/reset-empty and /restore-backup routes", () => {
  /** 写一个合法的备份文件（模拟之前 loadStore 备份的）。 */
  function writeValidBackupFile(timestamp: number, entries: unknown[]): string {
    const name = `credentials.json.corrupt-${timestamp}.json`;
    writeFileSync(
      join(tempDir, name),
      JSON.stringify({ entries, activeId: (entries[0] as { id?: string })?.id ?? null }),
      "utf-8",
    );
    return name;
  }

  it("POST /credentials/reset-empty writes clean empty store and clears corruption event", async () => {
    const app = await makeCredentialsApp();
    writeCorruptFile("}{broken");

    // 触发一次损坏（生成事件 + 备份）
    const corruptRes = await app.inject({ method: "GET", url: "/credentials" });
    expect(corruptRes.statusCode).toBe(500);

    // reset-empty 后
    const resetRes = await app.inject({ method: "POST", url: "/credentials/reset-empty" });
    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.json().ok).toBe(true);

    // 后续 GET /credentials 返正常空列表（事件已清除）
    const afterRes = await app.inject({ method: "GET", url: "/credentials" });
    expect(afterRes.statusCode).toBe(200);
    expect(afterRes.json()).toEqual({ entries: [], activeId: null });
    await app.close();
  });

  it("POST /credentials/restore-backup restores from latest backup", async () => {
    const app = await makeCredentialsApp();
    // 写一个合法备份（模拟之前 loadStore 备份的有效凭据）
    writeValidBackupFile(1000, [
      {
        id: "restored-id",
        label: "恢复的配置",
        provider: "openai",
        apiBaseUrl: "https://api.example.com",
        apiKey: "sk-restored",
        model: "gpt-image-2",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const restoreRes = await app.inject({ method: "POST", url: "/credentials/restore-backup" });
    expect(restoreRes.statusCode).toBe(200);
    const body = restoreRes.json();
    expect(body.ok).toBe(true);
    expect(body.entries).toBe(1);

    // GET /credentials 返恢复的列表
    const afterRes = await app.inject({ method: "GET", url: "/credentials" });
    expect(afterRes.json().entries[0].id).toBe("restored-id");
    await app.close();
  });

  it("POST /credentials/restore-backup returns 500 when backup is also corrupt", async () => {
    const app = await makeCredentialsApp();
    // 写一个损坏的备份
    writeFileSync(
      join(tempDir, "credentials.json.corrupt-1000.json"),
      "}{also-broken",
      "utf-8",
    );

    const restoreRes = await app.inject({ method: "POST", url: "/credentials/restore-backup" });
    expect(restoreRes.statusCode).toBe(500);
    const body = restoreRes.json();
    expect(body.error).toMatch(/仍无法解析/);
    await app.close();
  });
});
