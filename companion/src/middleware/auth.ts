import type { FastifyInstance } from "fastify";
import { validateToken } from "../pairingState.js";

const PUBLIC_PATHS = ["/health", "/pair/wait", "/pair/start", "/pair/confirm"];

export async function authMiddleware(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.includes(req.url)) return;

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
