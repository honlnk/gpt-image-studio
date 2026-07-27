import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { revokeUser, revokeJti } from "../auth/revocationList.js";

/**
 * /admin/revoke 路由（阶段三 PR3 SLO）—— 单点登出的后端通信端点。
 *
 * 宿主（IdP）在用户登出/封禁/改密时调用，把 user_id 或 jti 加入吊销黑名单。
 * Companion 后续请求立即拒绝被吊销的 user/jti。
 *
 * 鉴权：平台级管理密钥（ADMIN_API_KEY 环境变量），区别于用户 JWT 和 accessKey。
 * 这让宿主（而非普通用户）能管理吊销，符合 D10 的"宿主→Companion webhook"模型。
 *
 * 注意：此路由不走 authMiddleware（自带密钥验证），必须在 authMiddleware 之前注册，
 * 且 authMiddleware 的 LOOPBACK_GUARDED_PREFIXES / 跳过列表需包含 /admin/revoke。
 */

type RevokeBody = {
  user_id?: string;
  jwt_jti?: string;
  ttl_seconds?: number;
};

/**
 * 验证平台级管理密钥（timingSafeEqual 防时序攻击）。
 *
 * @returns true 表示密钥匹配或未配置 ADMIN_API_KEY（local 模式宽松）；false 表示拒绝。
 */
function validateAdminApiKey(req: FastifyRequest): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    // 未配置管理密钥——拒绝所有吊销请求（安全默认，避免误开放）
    return false;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

export async function adminRevokeRoutes(app: FastifyInstance) {
  app.post("/admin/revoke", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!validateAdminApiKey(req)) {
      return reply.status(401).send({ error: "未授权：无效的平台管理密钥" });
    }

    const body = req.body as RevokeBody;
    if (!body || (typeof body !== "object")) {
      return reply.status(400).send({ error: "请求体为空" });
    }

    const { user_id, jwt_jti, ttl_seconds } = body;
    if (!user_id && !jwt_jti) {
      return reply.status(400).send({ error: "至少需要 user_id 或 jwt_jti 之一" });
    }

    const ttl = typeof ttl_seconds === "number" && ttl_seconds > 0 ? ttl_seconds : undefined;
    const revoked: string[] = [];

    if (user_id) {
      revokeUser(user_id, ttl);
      revoked.push(`user:${user_id}`);
    }
    if (jwt_jti) {
      revokeJti(jwt_jti, ttl);
      revoked.push(`jti:${jwt_jti}`);
    }

    return { ok: true, revoked };
  });
}
