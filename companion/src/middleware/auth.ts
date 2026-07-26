import type { FastifyInstance } from "fastify";
import { validateAccessKey } from "../accessKey.js";

const PUBLIC_PATHS = ["/health"];

/**
 * loopback 守卫前缀集合。这些路由自带 loopback 来源校验（见 middleware/loopback.ts），
 * 不走连接密钥——
 *   /credentials：凭证管理发生在连接之前（首次需要先填 key 才有意义连接）。
 *   /admin：Companion 自带管理页（阶段零），同源 loopback 浏览器访问，不要求 accessKey。
 * authMiddleware 显式跳过这些前缀，把鉴权交给各自 plugin 内部的 loopbackGuard。
 */
const LOOPBACK_GUARDED_PREFIXES = ["/credentials", "/admin"];

export async function authMiddleware(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.includes(req.url)) return;
    if (LOOPBACK_GUARDED_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "未授权：缺少连接密钥" });
    }

    const token = authHeader.slice(7);
    if (!validateAccessKey(token)) {
      return reply.status(401).send({ error: "未授权：连接密钥无效" });
    }
  });
}
