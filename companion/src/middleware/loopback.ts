import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * loopback 主机名集合：凭证接口只接受来自本机的浏览器请求。
 * 注意 [::1] 是 IPv6 loopback 的 URL 表示形式。
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * 判断单个请求是否来自本机 loopback。
 *
 * 信任模型（与 CLI `gpt-image-studio login` 对齐）：
 * - 无 Origin 头（curl / 本机 CLI 直连）→ 放行，等同本机主人。
 * - 有 Origin 头（浏览器请求）→ 解析 hostname，必须是 127.0.0.1 / localhost / [::1]，
 *   否则视为远程请求，拒绝。这样即使 companion 某天被错误地暴露到 0.0.0.0 或经反向代理，
 *   凭证写入接口也无法被局域网/外网调用。
 *
 * 这是 pair.ts 里 `/pair/wait` 用 `req.headers.origin` 拒绝浏览器请求的反向应用：
 * 那里要保证"只 CLI 能触发"，这里要保证"只本机能写凭证"。
 */
export function isLoopbackRequest(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / CLI 直连
  try {
    const { hostname } = new URL(String(origin));
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * 注册凭证路由专用的 loopback onRequest 守卫。
 * 必须比 authMiddleware 更早注册（见 server.ts 的注册顺序），让非 loopback 请求在此短路，
 * 不进入后续 bearer token 校验——因为凭证接口本就不要求配对 token。
 */
export async function loopbackGuard(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!isLoopbackRequest(req)) {
      return reply.status(403).send({ error: "凭证接口只允许本机访问" });
    }
  });
}
