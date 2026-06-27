import Fastify from "fastify";
import cors from "@fastify/cors";
import { createRequire } from "node:module";
import type { CompanionHealthResponse } from "./types.js";
import { loadSession, isPaired } from "./pairingState.js";
import { pairRoutes } from "./routes/pair.js";
import { authRoutes } from "./routes/auth.js";
import { imagesRoutes } from "./routes/images.js";
import { authMiddleware } from "./middleware/auth.js";
import type { CompanionSecurityConfig } from "./securityConfig.js";
import { isOriginAllowed } from "./securityConfig.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const COMPANION_VERSION = packageJson.version;

export type CompanionRunMode = "serve" | "managed";

export async function startServer(opts: {
  port: number;
  security: CompanionSecurityConfig;
  runMode?: CompanionRunMode;
}) {
  loadSession();
  const runMode = opts.runMode ?? "serve";

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
    credentials: true,
  });

  await authMiddleware(app);
  await app.register(pairRoutes, {
    sessionTtlMs: opts.security.sessionTtlMs,
    allowDirectPairing: runMode === "serve",
  });
  await app.register(authRoutes);
  await app.register(imagesRoutes, { security: opts.security });

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: COMPANION_VERSION,
      paired: isPaired(),
      runMode,
    };
  });

  await app.listen({ host: "127.0.0.1", port: opts.port });
  console.log(`Companion 服务已启动: http://127.0.0.1:${opts.port}`);
  console.log(`版本: v${COMPANION_VERSION}`);
  console.log(`安全渠道: ${opts.security.channel}`);
  console.log("允许的 Origin:");
  opts.security.allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));

  if (!isPaired()) {
    if (runMode === "serve") {
      console.log("前台服务已就绪，可在网页端点击「开始配对」。");
    } else {
      console.log("需要配对时请运行：gpt-image-studio pair");
    }
  }
}
