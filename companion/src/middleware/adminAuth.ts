import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

/**
 * 平台级管理密钥守卫（ADMIN_API_KEY 环境变量）。
 *
 * 用于平台级管理面接口（凭据管理、SLO 吊销等），鉴权模型区别于：
 * - 用户 JWT（数据面，按租户隔离）
 * - accessKey（local 模式本机配对）
 * - loopbackGuard（本机浏览器/白名单站点，不校验 token）
 *
 * 平台级接口面向「部署操作员 / 宿主后端」，靠 ADMIN_API_KEY 这一个共享密钥鉴权。
 * 典型场景：server 模式下，宿主后端持有 ADMIN_API_KEY，代理运营管理员的凭据管理操作。
 *
 * 信任边界：持有 ADMIN_API_KEY 即被视为平台管理员，可读写所有租户的共享凭据。
 * 因此 ADMIN_API_KEY 必须只存在于宿主后端（或本机操作员手中），绝不下发到前端/租户。
 * 本地 demo（qiankun-host）把它放 gitignore 的 config.json，与 jwtSecret 同水位。
 */

/**
 * 验证平台级管理密钥（timingSafeEqual 防时序攻击）。
 *
 * 未配置 ADMIN_API_KEY 时一律返回 false（安全默认：拒绝所有管理请求，避免漏配密钥误开放）。
 */
function validateAdminApiKey(req: FastifyRequest): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    // 未配置管理密钥——拒绝所有管理请求（安全默认，避免误开放）
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

/**
 * 注册 onRequest 守卫：整个 plugin 命名空间下的所有路由都要求有效的平台管理密钥。
 *
 * 用法：plugin 内最先 `await adminKeyGuard(app)`，再注册具体路由。
 * 失败响应 401（与 adminRevoke 原实现一致）。
 */
export async function adminKeyGuard(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!validateAdminApiKey(req)) {
      return reply.status(401).send({ error: "未授权：无效的平台管理密钥" });
    }
  });
}
