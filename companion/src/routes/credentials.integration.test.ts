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
});

describe("/auth/status corruption handling", () => {
  it("returns 200 + corrupt:true + error when credentials corrupt", async () => {
    const app = await makeAuthApp();
    writeCorruptFile("}{broken");

    const res = await app.inject({ method: "GET", url: "/auth/status" });
    // /auth/status 返 200（而非 500）是为了让 Web 能拿到结构化信号——
    // Web 对 /auth/status 非 200 的处理是静默置空，会丢失原因。
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.corrupt).toBe(true);
    expect(body.ready).toBe(false);
    expect(body.error).toMatch(/无法解析/);
    // 损坏文件仍被备份
    expect(findBackupFile()).toBeDefined();
    await app.close();
  });

  it("returns normal status (no corrupt field) when credentials healthy", async () => {
    const app = await makeAuthApp();
    // 写一个合法的空 store
    writeCorruptFile(JSON.stringify({ entries: [], activeId: null }));

    const res = await app.inject({ method: "GET", url: "/auth/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.corrupt).toBeUndefined();
    expect(body.ready).toBe(false);
    await app.close();
  });
});
