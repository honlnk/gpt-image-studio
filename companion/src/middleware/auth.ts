import type { FastifyInstance } from "fastify";
import { validateAccessKey } from "../accessKey.js";
import { verifyJwt, JwtVerificationError } from "../auth/jwt.js";
import type { DeploymentMode } from "../deploymentConfig.js";

const PUBLIC_PATHS = ["/health"];

/**
 * loopback 守卫前缀集合。这些路由自带 loopback 来源校验（见 middleware/loopback.ts），
 * 不走连接密钥——
 *   /credentials：凭证管理发生在连接之前（首次需要先填 key 才有意义连接）。
 *   /admin：Companion 自带管理页（阶段零），同源 loopback 浏览器访问，不要求 accessKey。
 *   /storage/oss：OSS 凭据管理（阶段二 PR5），敏感的长期 AK 不应跨域暴露，走管理面守卫。
 * authMiddleware 显式跳过这些前缀，把鉴权交给各自 plugin 内部的 loopbackGuard。
 */
const LOOPBACK_GUARDED_PREFIXES = ["/credentials", "/admin", "/storage/oss"];

export type AuthMiddlewareOptions = {
  /** 部署形态：local 走 accessKey，server 走 JWT。 */
  mode: DeploymentMode;
  /** JWT 验签密钥（server 模式必填）。 */
  jwtSecret?: string;
};

/**
 * 认证中间件（双模式，阶段三 PR2）。
 *
 * - local 模式（阶段二行为）：bearer accessKey 验证。通过则 req.user = { userId: '__local__' }。
 * - server 模式：HS256 JWT 验证（验签 + 过期检查）。通过则 req.user = { userId: jwt.sub, displayName }。
 *
 * 两种模式都跳过 PUBLIC_PATHS 和 LOOPBACK_GUARDED_PREFIXES（这些路由各自有守卫）。
 * storage 路由从 req.user.userId 定位用户数据目录，实现多租户隔离。
 */
export async function authMiddleware(app: FastifyInstance, opts: AuthMiddlewareOptions) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.includes(req.url)) return;
    if (LOOPBACK_GUARDED_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "未授权：缺少认证凭证" });
    }
    const token = authHeader.slice(7);

    if (opts.mode === "server") {
      // server 模式：JWT 验证
      if (!opts.jwtSecret) {
        // 启动时应已校验，这里是防御性检查
        return reply.status(500).send({ error: "服务器未配置 JWT_SECRET" });
      }
      try {
        const payload = verifyJwt(token, opts.jwtSecret);
        req.user = {
          userId: payload.sub,
          displayName: payload.display_name,
        };
      } catch (e) {
        const msg =
          e instanceof JwtVerificationError ? e.message : "JWT 验证失败";
        return reply.status(401).send({ error: `未授权：${msg}` });
      }
    } else {
      // local 模式：accessKey 验证（阶段二行为）
      if (!validateAccessKey(token)) {
        return reply.status(401).send({ error: "未授权：连接密钥无效" });
      }
      req.user = { userId: "__local__" };
    }
  });
}
