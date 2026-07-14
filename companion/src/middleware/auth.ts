import type { FastifyInstance } from "fastify";
import { validateToken } from "../pairingState.js";

const PUBLIC_PATHS = ["/health", "/pair/wait", "/pair/start", "/pair/confirm"];

/**
 * 凭证管理路由的前缀。这些路由自带 loopback 来源校验（见 middleware/loopback.ts），
 * 不走配对 session token——因为凭证管理发生在配对之前（首次需要先填 key 才能配对）。
 * authMiddleware 显式跳过此前缀，把鉴权交给 credentialsRoutes 内部的 loopbackGuard。
 */
const LOOPBACK_GUARDED_PREFIX = "/credentials";

export async function authMiddleware(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.includes(req.url)) return;
    if (req.url.startsWith(LOOPBACK_GUARDED_PREFIX)) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "未授权：缺少 session token" });
    }

    const token = authHeader.slice(7);
    if (!validateToken(token)) {
      return reply.status(401).send({ error: "未授权：token 无效" });
    }
  });
}
