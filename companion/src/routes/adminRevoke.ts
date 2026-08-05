import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { revokeUser, revokeJti } from "../auth/revocationList.js";
import { adminKeyGuard } from "../middleware/adminAuth.js";

/**
 * /admin/revoke 路由（阶段三 PR3 SLO）—— 单点登出的后端通信端点。
 *
 * 宿主（IdP）在用户登出/封禁/改密时调用，把 user_id 或 jti 加入吊销黑名单。
 * Companion 后续请求立即拒绝被吊销的 user/jti。
 *
 * 鉴权：平台级管理密钥（ADMIN_API_KEY 环境变量），区别于用户 JWT 和 accessKey。
 * 这让宿主（而非普通用户）能管理吊销，符合 D10 的"宿主→Companion webhook"模型。
 *
 * 注意：此路由不走 authMiddleware（adminKeyGuard 自带密钥验证），必须在 authMiddleware 之前注册，
 * 且 authMiddleware 的 LOOPBACK_GUARDED_PREFIXES / 跳过列表需包含 /admin/revoke。
 */

type RevokeBody = {
  user_id?: string;
  jwt_jti?: string;
  ttl_seconds?: number;
};

export async function adminRevokeRoutes(app: FastifyInstance) {
  // 平台级管理密钥守卫（ADMIN_API_KEY）。未配置/错误密钥 → 401。
  await adminKeyGuard(app);

  app.post("/admin/revoke", async (req: FastifyRequest, reply: FastifyReply) => {
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
