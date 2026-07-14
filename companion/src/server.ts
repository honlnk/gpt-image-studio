import Fastify from "fastify";
import cors from "@fastify/cors";
import { createRequire } from "node:module";
import type { CompanionHealthResponse } from "./types.js";
import { loadOrCreateAccessKey } from "./accessKey.js";
import { authRoutes } from "./routes/auth.js";
import { imagesRoutes } from "./routes/images.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { logsRoutes } from "./routes/logs.js";
import { authMiddleware } from "./middleware/auth.js";
import type { CompanionSecurityConfig } from "./securityConfig.js";
import { isOriginAllowed } from "./securityConfig.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const COMPANION_VERSION = packageJson.version;

export async function startServer(opts: {
  port: number;
  security: CompanionSecurityConfig;
}) {
  loadOrCreateAccessKey();

  const app = Fastify({
    bodyLimit: opts.security.maxJsonBodyBytes,
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.authorization",
        "headers.authorization",
        "apiKey",
        "api_key",
        "b64_json",
      ],
    },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isOriginAllowed(origin, opts.security.allowedOrigins));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // 注册顺序很重要：
  // 1) credentialsRoutes 自带 loopbackGuard，必须在 authMiddleware 之前注册，
  //    否则 /credentials/* 会被 bearer 守卫拦成 401（凭证接口不走连接密钥）。
  // 2) authMiddleware（bearer token 守卫）。
  // 3) 其余受保护路由 + logsRoutes（日志走连接密钥，放在 authMiddleware 之后）。
  await app.register(credentialsRoutes);
  await authMiddleware(app);
  await app.register(authRoutes);
  await app.register(imagesRoutes, { security: opts.security });
  await app.register(logsRoutes);

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: COMPANION_VERSION,
    };
  });

  await app.listen({ host: "127.0.0.1", port: opts.port });
  console.log(`Companion 服务已启动: http://127.0.0.1:${opts.port}`);
  console.log(`版本: v${COMPANION_VERSION}`);
  console.log(`安全渠道: ${opts.security.channel}`);
  console.log("允许的 Origin:");
  opts.security.allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));
  console.log("");
  console.log("=".repeat(60));
  console.log("  连接密钥（请粘进网页 /companion 页面完成连接）");
  console.log(`  ${loadOrCreateAccessKey()}`);
  console.log("=".repeat(60));
}
