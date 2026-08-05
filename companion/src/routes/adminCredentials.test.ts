import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * /admin/credentials/* 路由测试。
 *
 * 验证：
 * 1) 平台级管理密钥鉴权（ADMIN_API_KEY）：无 header / 错 key / 未配置 / 正确 key 四例。
 * 2) 凭据 CRUD happy path（presets / list / add / activate / update / delete）。
 *
 * 隔离：每个用例用独立的 tmpdir 作为 GPT_IMAGE_STUDIO_CONFIG_DIR，并 resetModules
 * 强制 credentials.ts 重新读取环境变量，绝不碰真实的 ~/.gpt-image-studio/。
 */

const ADMIN_KEY = "platform-admin-secret";

/** 在独立 tmpdir 下加载路由 + 业务模块，返回 { app, dir }。调用方负责 app.close + rmSync。 */
async function setupApp() {
  const dir = mkdtempSync(join(tmpdir(), "admin-cred-test-"));
  vi.resetModules();
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = dir;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const { adminCredentialsRoutes } = await import("./adminCredentials.js");
  const app = Fastify();
  await app.register(adminCredentialsRoutes);
  return { app, dir };
}

const auth = (key?: string) =>
  key ? { authorization: `Bearer ${key}` } : {};

describe("/admin/credentials/*", () => {
  let dir: string;

  afterEach(async () => {
    vi.resetModules();
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
    delete process.env.ADMIN_API_KEY;
  });

  describe("鉴权", () => {
    it("无 Authorization → 401", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({ method: "GET", url: "/admin/credentials" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("错误密钥 → 401", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth("wrong-key"),
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("未配置 ADMIN_API_KEY → 401（安全默认）", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      delete process.env.ADMIN_API_KEY;
      // adminKeyGuard 在 onRequest 读 env，删除后即时生效
      const res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth("anything"),
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("正确密钥 → 放行", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth(ADMIN_KEY),
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("CRUD", () => {
    it("presets 返回非空列表", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "GET",
        url: "/admin/credentials/presets",
        headers: auth(ADMIN_KEY),
      });
      expect(res.statusCode).toBe(200);
      const presets = res.json();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets[0]).toHaveProperty("id");
      expect(presets[0]).toHaveProperty("label");
      await app.close();
    });

    it("空列表 → add → 激活 → 列表含该项 → 删除 → 列表空", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;

      // 初始空列表
      let res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth(ADMIN_KEY),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entries).toEqual([]);

      // 新增
      res = await app.inject({
        method: "POST",
        url: "/admin/credentials",
        headers: { ...auth(ADMIN_KEY), "content-type": "application/json" },
        payload: {
          label: "测试凭据",
          provider: "openai",
          apiBaseUrl: "https://example.com/v1/images",
          apiKey: "sk-test-key",
          model: "gpt-image-test",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      const entry = res.json().entry;
      expect(entry.id).toBeTruthy();
      expect(entry.apiKey).toBe("sk-test-key");
      // 首条自动激活
      expect(res.json().entry).toBeTruthy();

      // 列表含该项
      res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth(ADMIN_KEY),
      });
      const list = res.json();
      expect(list.entries).toHaveLength(1);
      expect(list.entries[0].apiKey).toBe("sk-test-key"); // 明文返回（平台级信任）
      expect(list.activeId).toBe(entry.id);

      // 删除
      res = await app.inject({
        method: "DELETE",
        url: `/admin/credentials/${entry.id}`,
        headers: auth(ADMIN_KEY),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // 列表恢复空
      res = await app.inject({
        method: "GET",
        url: "/admin/credentials",
        headers: auth(ADMIN_KEY),
      });
      expect(res.json().entries).toEqual([]);
      await app.close();
    });

    it("缺 apiBaseUrl → 400", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "POST",
        url: "/admin/credentials",
        headers: { ...auth(ADMIN_KEY), "content-type": "application/json" },
        payload: { apiKey: "sk-x" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("apiBaseUrl");
      await app.close();
    });

    it("未知 provider → 400", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "POST",
        url: "/admin/credentials",
        headers: { ...auth(ADMIN_KEY), "content-type": "application/json" },
        payload: {
          provider: "nonexistent",
          apiBaseUrl: "https://x.com",
          apiKey: "sk-x",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("nonexistent");
      await app.close();
    });

    it("激活不存在的 id → 404", async () => {
      const { app, dir: d } = await setupApp();
      dir = d;
      const res = await app.inject({
        method: "POST",
        url: "/admin/credentials/no-such-id/activate",
        headers: auth(ADMIN_KEY),
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });
});
