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
import { adminRevokeRoutes } from "./routes/adminRevoke.js";
import { adminCredentialsRoutes } from "./routes/adminCredentials.js";
import { authMiddleware } from "./middleware/auth.js";
import { startCleanupTimer } from "./auth/revocationList.js";
import type { CompanionSecurityConfig } from "./securityConfig.js";
import { isOriginAllowed } from "./securityConfig.js";
import type { DeploymentConfig } from "./deploymentConfig.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const COMPANION_VERSION = packageJson.version;

export async function startServer(opts: {
  port: number;
  host: string;
  security: CompanionSecurityConfig;
  deployment: DeploymentConfig;
}) {
  loadOrCreateAccessKey();

  // server 模式启动校验：JWT_SECRET 必填（多租户认证依赖）
  const jwtSecret = process.env.JWT_SECRET;
  if (opts.deployment.mode === "server" && !jwtSecret) {
    throw new Error(
      "server 部署形态需要 JWT_SECRET 环境变量（与宿主共享的 HS256 验签密钥）。请在环境变量中配置后重启。",
    );
  }

  // server 模式启动吊销黑名单清理定时器（阶段三 PR3 SLO）
  if (opts.deployment.mode === "server") {
    startCleanupTimer();
    // OSS STS 依赖宿主接口（D11）。filesystem 模式不需要，缺失只 warning 不阻断。
    if (!process.env.MAIN_APP_URL || !process.env.MAIN_APP_API_KEY) {
      console.warn(
        "⚠️  server 模式下 OSS 存储需要 MAIN_APP_URL 和 MAIN_APP_API_KEY 环境变量（宿主 STS 签发接口）。filesystem 模式不受影响。",
      );
    }
  }

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
  //    否则 /credentials/* 和 /admin* 会被守卫拦成 401（这两类接口都不走连接密钥/JWT，
  //    只认本机来源或显式白名单）。
  // 2) authMiddleware（双模式守卫：local=accessKey，server=JWT）。跳过 /credentials /admin /storage/oss。
  // 3) 其余受保护路由 + logsRoutes（放在 authMiddleware 之后）。
  await app.register(credentialsRoutes, { allowedOrigins: opts.security.allowedOrigins });
  // 管理页（/admin 页面 + /admin/api/*）是本机单用户管理面：数据集视图固定 __local__
  // 虚拟用户（见 routes/admin.ts），server 模式多租户不经过这里，显示无意义且误导，
  // 故 server 模式下不注册（404）。注意 /admin/revoke（SLO 吊销端点）不属于管理页，
  // server 模式仍需注册（下方 adminRevokeRoutes）。
  if (opts.deployment.mode !== "server") {
    await app.register(adminRoutes, { allowedOrigins: opts.security.allowedOrigins });
  }
  // /admin/revoke 吊销端点（阶段三 PR3 SLO）：走平台级管理密钥（ADMIN_API_KEY），
  // 不走 authMiddleware。/admin 前缀已被 authMiddleware 跳过，这里在 authMiddleware
  // 之前注册即可。
  await app.register(adminRevokeRoutes);
  // /admin/credentials/* 平台级凭据管理（server 模式管理面入口）：与 /admin/revoke
  // 同属 /admin/* 命名空间，走 ADMIN_API_KEY（adminKeyGuard），不走 authMiddleware。
  // 端点结构镜像 /credentials/*（loopbackGuard，local 模式本机用），读写同一凭据存储，
  // 给 server 模式的宿主后端/操作员一条可远程访问的凭据管理路径（657c172 禁用默认
  // 管理页后补的缺口）。全模式注册——local 模式操作员也可用平台密钥管理。
  await app.register(adminCredentialsRoutes);
  // OSS 凭据管理（阶段二 PR5）：自带 loopbackGuard，必须在 authMiddleware 之前注册，
  // 否则 /storage/oss/* 会被守卫拦成 401（OSS 凭据敏感，走管理面守卫而非数据面）。
  await app.register(storageOssRoutes, { allowedOrigins: opts.security.allowedOrigins });
  await authMiddleware(app, { mode: opts.deployment.mode, jwtSecret });
  await app.register(authRoutes);
  await app.register(imagesRoutes, { security: opts.security });
  await app.register(logsRoutes);
  // 存储路由（阶段二+三）：7 表 CRUD + 图片二进制 + 配置 + 数据集管理 + 容量估算。
  // 走 authMiddleware（local=accessKey / server=JWT），从 req.user.userId 定位用户数据目录。
  await app.register(storageRoutes);

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: COMPANION_VERSION,
    };
  });

  await app.listen({ host: opts.host, port: opts.port });
  // 启动时保证有一个可用的默认数据集（local 模式的虚拟用户 '__local__'）。
  // server 模式下每个用户首次访问时由 storage 路由懒创建各自的默认数据集。
  try {
    const defaultDataset = await ensureDefaultDataset();
    console.log(`默认数据集已就绪: ${defaultDataset.label} (${defaultDataset.image_store_kind})`);
  } catch (err) {
    console.warn("默认数据集初始化失败，Companion 存储模式需手动激活:", err);
  }
  console.log(`Companion 服务已启动: http://${opts.host}:${opts.port}`);
  console.log(`版本: v${COMPANION_VERSION}`);
  console.log(`部署形态: ${opts.deployment.mode}`);
  if (opts.deployment.mode === "server") {
    console.log("管理页: 已禁用（server 模式多租户由宿主/API 按用户管理）");
    console.log("  凭据管理: /admin/credentials/*（ADMIN_API_KEY 鉴权，宿主/操作员远程管理）");
  }
  console.log(`安全渠道: ${opts.security.channel}`);
  console.log("允许的 Origin:");
  opts.security.allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));
  console.log("");
  if (opts.deployment.mode === "local") {
    console.log("=".repeat(60));
    console.log("  连接密钥（请粘进 Web 工作台的 Companion 连接框）");
    console.log(`  ${loadOrCreateAccessKey()}`);
    console.log("=".repeat(60));
  } else {
    console.log("=".repeat(60));
    console.log("  server 模式：使用宿主签发的 JWT 访问（Authorization: Bearer <jwt>）");
    console.log(`  JWT_SECRET 已配置（${jwtSecret!.length} 字符）`);
    console.log("=".repeat(60));
  }
  // 0.0.0.0 不能直接浏览器访问，提示用本机回环地址（server 模式下用户应通过实际域名/IP 访问）
  // server 模式管理页已禁用（不注册 adminRoutes），不再打印入口
  if (opts.deployment.mode !== "server") {
    const adminDisplayHost = opts.host === "0.0.0.0" ? "127.0.0.1" : opts.host;
    console.log(`  管理页：http://${adminDisplayHost}:${opts.port}/admin`);
  }
  console.log("=".repeat(60));
}
