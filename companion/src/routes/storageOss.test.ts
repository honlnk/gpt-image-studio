import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * /storage/oss/* 路由集成测试。
 *
 * 这些路由走 loopbackGuard（非 bearer），app.inject 默认无 Origin 头，loopbackGuard
 * 视为本机直连放行。
 *
 * PUT/POST 涉及真实 OSS 连通性测试，这里用 vi.mock 替换 testOssConnection，
 * 避免测试依赖网络。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-oss-route-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function makeApp(): Promise<FastifyInstance> {
  const { storageOssRoutes } = await import("./storageOss.js");
  const app: FastifyInstance = Fastify();
  await app.register(storageOssRoutes);
  return app;
}

describe("/storage/oss/config", () => {
  it("GET 未配置返回 404 + configured:false", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/storage/oss/config" });
    expect(res.statusCode).toBe(404);
    expect(res.json().configured).toBe(false);
    await app.close();
  });

  it("GET 已配置返回脱敏视图", async () => {
    // 先写入凭据
    const { saveOssCredentials } = await import("../storage/ossCredentials.js");
    saveOssCredentials({
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "b",
      accessKeyId: "LTAI5tLongKeyIdExample",
      accessKeySecret: "secretvalue123456789",
    });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/storage/oss/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.endpoint).toBe("oss-cn-hangzhou.aliyuncs.com");
    expect(body.bucket).toBe("b");
    expect(body.accessKeyIdMasked).toMatch(/\*/);
    expect(JSON.stringify(body)).not.toContain("secretvalue123456789");
    await app.close();
  });

  it("GET 不返回 accessKeySecret", async () => {
    const { saveOssCredentials } = await import("../storage/ossCredentials.js");
    const secret = "super-secret-key-value";
    saveOssCredentials({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: secret,
    });
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/storage/oss/config" });
    expect(res.body).not.toContain(secret);
    await app.close();
  });
});

describe("/storage/oss/config PUT (mocked 连通性测试)", () => {
  it("连通性测试失败返回 400 不保存", async () => {
    // mock testOssConnection 返回失败
    vi.doMock("../storage/ossImageStore.js", () => ({
      testOssConnection: vi.fn().mockResolvedValue({ ok: false, error: "连接被拒绝" }),
    }));
    const app = await makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/storage/oss/config",
      payload: {
        endpoint: "e",
        bucket: "b",
        accessKeyId: "ak",
        accessKeySecret: "sk",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().connected).toBe(false);
    // 凭据未保存
    const { loadOssCredentials } = await import("../storage/ossCredentials.js");
    expect(loadOssCredentials()).toBeUndefined();
    await app.close();
  });

  it("连通性测试成功则保存", async () => {
    vi.doMock("../storage/ossImageStore.js", () => ({
      testOssConnection: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const app = await makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/storage/oss/config",
      payload: {
        endpoint: "oss-cn-hangzhou.aliyuncs.com",
        bucket: "my-bucket",
        accessKeyId: "LTAI5tKey",
        accessKeySecret: "secretvalue",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toBe(true);
    // 凭据已保存
    const { loadOssCredentials } = await import("../storage/ossCredentials.js");
    const creds = loadOssCredentials();
    expect(creds?.bucket).toBe("my-bucket");
    await app.close();
  });

  it("字段缺失返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "PUT",
      url: "/storage/oss/config",
      payload: { endpoint: "e" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("/storage/oss/config DELETE", () => {
  it("删除已配置凭据", async () => {
    const { saveOssCredentials, loadOssCredentials } = await import(
      "../storage/ossCredentials.js"
    );
    saveOssCredentials({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
    });
    const app = await makeApp();
    const res = await app.inject({ method: "DELETE", url: "/storage/oss/config" });
    expect(res.statusCode).toBe(200);
    expect(loadOssCredentials()).toBeUndefined();
    await app.close();
  });
});

describe("/storage/oss/test POST (mocked)", () => {
  it("连通性成功返回 connected:true", async () => {
    vi.doMock("../storage/ossImageStore.js", () => ({
      testOssConnection: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/storage/oss/test",
      payload: {
        endpoint: "e",
        bucket: "b",
        accessKeyId: "ak",
        accessKeySecret: "sk",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().connected).toBe(true);
    await app.close();
  });

  it("字段缺失返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/storage/oss/test",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("loopbackGuard 鉴权", () => {
  it("非 loopback Origin 返回 403", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/storage/oss/config",
      headers: { origin: "https://evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("loopback Origin 放行", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/storage/oss/config",
      headers: { origin: "http://127.0.0.1:8888" },
    });
    // 404 是「未配置」的正常响应，说明 loopbackGuard 放行了
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
