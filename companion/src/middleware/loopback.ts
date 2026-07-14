import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * loopback 主机名集合：凭证接口默认只接受来自本机的浏览器请求。
 * 注意 [::1] 是 IPv6 loopback 的 URL 表示形式。
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * 判断单个请求是否来自本机 loopback 或已配置的白名单 origin。
 *
 * 信任模型（与 CLI `gpt-image-studio provider add` 对齐）：
 * - 无 Origin 头（curl / 本机 CLI 直连）→ 放行，等同本机主人。
 * - 有 Origin 头（浏览器请求）→ 解析 hostname，必须是 127.0.0.1 / localhost / [::1]，
 *   或 origin 在 securityConfig 的 allowedOrigins 白名单里（如 image.honlnk.com）。
 *   这样远程网站只能在 CORS 白名单 + loopback 白名单双重放行时才能操作凭证。
 *
 * 这与凭证接口的特殊信任模型一致：凭证管理发生在连接之前，
 * 不走连接密钥，只认本机来源或显式白名单。
 */
export function isLoopbackRequest(req: FastifyRequest, allowedOrigins: string[] = []): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / CLI 直连
  try {
    const originStr = String(origin);
    // 白名单 origin 直接放行（如 https://image.honlnk.com）
    if (allowedOrigins.includes(originStr)) return true;
    const { hostname } = new URL(originStr);
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * 注册凭证路由专用的 loopback onRequest 守卫。
 * 必须比 authMiddleware 更早注册（见 server.ts 的注册顺序），让非 loopback 请求在此短路，
 * 不进入后续 bearer token 校验——因为凭证接口本就不要求配对 token。
 *
 * allowedOrigins 与 CORS 白名单共享（来自 securityConfig），让受信任的远程站点
 * （如 image.honlnk.com）也能管理凭证，非白名单站点仍被拒绝。
 */
export async function loopbackGuard(app: FastifyInstance, allowedOrigins: string[] = []): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!isLoopbackRequest(req, allowedOrigins)) {
      return reply.status(403).send({ error: "凭证接口只允许本机或白名单来源访问" });
    }
  });
}
