import Fastify from "fastify";
import cors from "@fastify/cors";
import { createRequire } from "node:module";
import type { CompanionHealthResponse } from "./types.js";
import { loadOrCreateAccessKey } from "./accessKey.js";
import { authRoutes } from "./routes/auth.js";
import { imagesRoutes } from "./routes/images.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { adminRoutes } from "./routes/admin.js";
import { logsRoutes } from "./routes/logs.js";
import { storageRoutes, ensureDefaultDataset } from "./routes/storage.js";
import { storageOssRoutes } from "./routes/storageOss.js";
import { authMiddleware } from "./middleware/auth.js";
import type { CompanionSecurityConfig } from "./securityConfig.js";
import { isOriginAllowed } from "./securityConfig.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const COMPANION_VERSION = packageJson.version;

export async function startServer(opts: {
  port: number;
  host: string;
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
  // 1) credentialsRoutes / adminRoutes 自带 loopbackGuard，必须在 authMiddleware 之前注册，
  //    否则 /credentials/* 和 /admin* 会被 bearer 守卫拦成 401（这两类接口都不走连接密钥，
  //    只认本机来源或显式白名单）。
  // 2) authMiddleware（bearer token 守卫）。会显式跳过 /credentials 和 /admin 前缀。
  // 3) 其余受保护路由 + logsRoutes（日志走连接密钥，放在 authMiddleware 之后）。
  await app.register(credentialsRoutes, { allowedOrigins: opts.security.allowedOrigins });
  await app.register(adminRoutes, { allowedOrigins: opts.security.allowedOrigins });
  // OSS 凭据管理（阶段二 PR5）：自带 loopbackGuard，必须在 authMiddleware 之前注册，
  // 否则 /storage/oss/* 会被 bearer 守卫拦成 401（OSS 凭据敏感，走管理面守卫而非数据面）。
  await app.register(storageOssRoutes, { allowedOrigins: opts.security.allowedOrigins });
  await authMiddleware(app);
  await app.register(authRoutes);
  await app.register(imagesRoutes, { security: opts.security });
  await app.register(logsRoutes);
  // 存储路由（阶段二）：7 表 CRUD + 图片二进制 + 配置 + 数据集管理 + 容量估算。
  // 走 bearer accessKey（authMiddleware 已在上面生效），与 imagesRoutes 同级。
  await app.register(storageRoutes);

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: COMPANION_VERSION,
    };
  });

  await app.listen({ host: opts.host, port: opts.port });
  // 启动时保证有一个可用的默认数据集（选项 B），让 Companion 模式立即可用
  try {
    const defaultDataset = await ensureDefaultDataset();
    console.log(`默认数据集已就绪: ${defaultDataset.label} (${defaultDataset.image_store_kind})`);
  } catch (err) {
    console.warn("默认数据集初始化失败，Companion 存储模式需手动激活:", err);
  }
  console.log(`Companion 服务已启动: http://${opts.host}:${opts.port}`);
  console.log(`版本: v${COMPANION_VERSION}`);
  console.log(`安全渠道: ${opts.security.channel}`);
  console.log("允许的 Origin:");
  opts.security.allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));
  console.log("");
  console.log("=".repeat(60));
  console.log("  连接密钥（请粘进 Web 工作台的 Companion 连接框）");
  console.log(`  ${loadOrCreateAccessKey()}`);
  console.log("=".repeat(60));
  // 0.0.0.0 不能直接浏览器访问，提示用本机回环地址（server 模式下用户应通过实际域名/IP 访问）
  const adminDisplayHost = opts.host === "0.0.0.0" ? "127.0.0.1" : opts.host;
  console.log(`  管理页：http://${adminDisplayHost}:${opts.port}/admin`);
  console.log("=".repeat(60));
}
