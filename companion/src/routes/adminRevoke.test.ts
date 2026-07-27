import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { adminRevokeRoutes } from "./adminRevoke.js";
import { isUserRevoked, isJtiRevoked, clear } from "../auth/revocationList.js";

/**
 * /admin/revoke 路由测试（阶段三 PR3 SLO）。
 *
 * 验证平台级管理密钥鉴权 + user_id/jti 吊销 + 请求体校验。
 */

const ADMIN_KEY = "platform-admin-secret";

describe("/admin/revoke", () => {
  let app: InstanceType<typeof Fastify>;

  beforeEach(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    clear();
    app = Fastify();
    await app.register(adminRevokeRoutes);
  });

  afterEach(async () => {
    delete process.env.ADMIN_API_KEY;
    clear();
    await app.close();
  });

  describe("鉴权", () => {
    it("无 Authorization → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        payload: { user_id: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("错误密钥 → 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: "Bearer wrong-key" },
        payload: { user_id: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("未配置 ADMIN_API_KEY → 401（安全默认）", async () => {
      delete process.env.ADMIN_API_KEY;
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: "Bearer anything" },
        payload: { user_id: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("正确密钥 → 放行", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { user_id: "user-1" },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("请求体校验", () => {
    it("缺少 user_id 和 jwt_jti → 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("user_id 或 jwt_jti");
    });

    it("只传 user_id → 200", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { user_id: "user-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(isUserRevoked("user-1")).toBe(true);
    });

    it("只传 jwt_jti → 200", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { jwt_jti: "jti-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(isJtiRevoked("jti-1")).toBe(true);
    });

    it("同时传 user_id 和 jwt_jti → 两者都吊销", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { user_id: "user-1", jwt_jti: "jti-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().revoked).toEqual(["user:user-1", "jti:jti-1"]);
      expect(isUserRevoked("user-1")).toBe(true);
      expect(isJtiRevoked("jti-1")).toBe(true);
    });
  });

  describe("自定义 TTL", () => {
    it("ttl_seconds 透传到吊销", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/revoke",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { user_id: "user-1", ttl_seconds: 120 },
      });
      expect(res.statusCode).toBe(200);
      expect(isUserRevoked("user-1")).toBe(true);
    });
  });
});
