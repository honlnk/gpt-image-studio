import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { authMiddleware } from "./auth.js";
import { signJwtForTesting } from "../auth/jwt.js";
import { revokeUser, revokeJti, clear } from "../auth/revocationList.js";

/**
 * authMiddleware 双模式测试（阶段三 PR2）。
 *
 * local 模式：accessKey 验证（阶段二行为）。
 * server 模式：JWT 验证（HS256 + exp）。
 *
 * 用真实的 Fastify 实例 + authMiddleware 注册，发模拟请求验证。
 * accessKey 验证通过 mock validateAccessKey 实现（不依赖磁盘文件）。
 */

// Mock accessKey 模块，让 local 模式测试可控
vi.mock("../accessKey.js", () => ({
  validateAccessKey: vi.fn((token: string) => token === "valid-access-key"),
  loadOrCreateAccessKey: vi.fn(() => "valid-access-key"),
}));

async function buildApp(opts: { mode: "local" | "server"; jwtSecret?: string }) {
  const app = Fastify();
  await authMiddleware(app, { mode: opts.mode, jwtSecret: opts.jwtSecret });
  app.get("/protected", async (req) => ({ userId: req.user?.userId }));
  app.get("/health", async () => ({ ok: true }));
  return app;
}

describe("authMiddleware", () => {
  describe("PUBLIC_PATHS 跳过", () => {
    it("local 模式 /health 不需要认证", async () => {
      const app = await buildApp({ mode: "local" });
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("server 模式 /health 不需要认证", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: "secret" });
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("local 模式（accessKey）", () => {
    it("有效 accessKey → 通过，req.user.userId='__local__'", async () => {
      const app = await buildApp({ mode: "local" });
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer valid-access-key" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: "__local__" });
      await app.close();
    });

    it("无效 accessKey → 401", async () => {
      const app = await buildApp({ mode: "local" });
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer wrong-key" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("缺少 Authorization → 401", async () => {
      const app = await buildApp({ mode: "local" });
      const res = await app.inject({ method: "GET", url: "/protected" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("server 模式（JWT）", () => {
    const SECRET = "jwt-secret";

    it("有效 JWT → 通过，req.user.userId=jwt.sub", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const token = signJwtForTesting({ sub: "user-123", display_name: "Alice" }, SECRET);
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: "user-123" });
      await app.close();
    });

    it("无效签名 JWT → 401", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const token = signJwtForTesting({ sub: "user-123" }, "wrong-secret");
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("过期 JWT → 401", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const token = signJwtForTesting({ sub: "user-123", exp: pastExp }, SECRET);
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("过期");
      await app.close();
    });

    it("alg=none JWT → 401", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const token = signJwtForTesting({ sub: "user-123" }, SECRET, "none");
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("缺少 Authorization → 401", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const res = await app.inject({ method: "GET", url: "/protected" });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("display_name 透传到 req.user", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: SECRET });
      const token = signJwtForTesting({ sub: "user-1", display_name: "张三" }, SECRET);
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("LOOPBACK_GUARDED_PREFIXES 跳过", () => {
    it("/credentials 前缀跳过 authMiddleware", async () => {
      const app = await buildApp({ mode: "local" });
      // 注册一个 /credentials 测试路由（模拟 credentialsRoutes 自带 loopbackGuard）
      app.get("/credentials/test", async () => ({ ok: true }));
      const res = await app.inject({ method: "GET", url: "/credentials/test" });
      // 不被 authMiddleware 拦截（具体鉴权由 credentialsRoutes 内部的 loopbackGuard 负责）
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("/admin 前缀跳过 authMiddleware", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: "x" });
      app.get("/admin/test", async () => ({ ok: true }));
      const res = await app.inject({ method: "GET", url: "/admin/test" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("server 模式吊销黑名单（阶段三 PR3 SLO）", () => {
    const REVOKE_SECRET = "revoke-test-secret";

    beforeEach(() => {
      clear();
    });
    afterEach(() => {
      clear();
    });

    it("被吊销的用户 JWT → 401", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: REVOKE_SECRET });
      const token = signJwtForTesting({ sub: "banned-user" }, REVOKE_SECRET);
      // 吊销前通过
      const res1 = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res1.statusCode).toBe(200);

      // 吊销该用户
      revokeUser("banned-user");

      // 吊销后拒绝
      const res2 = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json().error).toContain("吊销");
      await app.close();
    });

    it("被吊销的 jti → 401，其他 jti 不受影响", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: REVOKE_SECRET });
      const token1 = signJwtForTesting({ sub: "user-1", jti: "jti-A" }, REVOKE_SECRET);
      const token2 = signJwtForTesting({ sub: "user-1", jti: "jti-B" }, REVOKE_SECRET);

      // 吊销 jti-A
      revokeJti("jti-A");

      // jti-A 被拒
      const res1 = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token1}` },
      });
      expect(res1.statusCode).toBe(401);

      // jti-B 仍可用（同用户，不同 jti）
      const res2 = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token2}` },
      });
      expect(res2.statusCode).toBe(200);
      await app.close();
    });

    it("user 吊销优先于 jti（user 被吊销时所有 jti 都拒）", async () => {
      const app = await buildApp({ mode: "server", jwtSecret: REVOKE_SECRET });
      revokeUser("user-1");
      const token = signJwtForTesting({ sub: "user-1", jti: "any-jti" }, REVOKE_SECRET);
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });
});
