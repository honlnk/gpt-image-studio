import Fastify from "fastify";
import cors from "@fastify/cors";
import type { CompanionHealthResponse } from "./types.js";
import { loadSession, isPaired } from "./pairingState.js";
import { pairRoutes } from "./routes/pair.js";
import { authRoutes } from "./routes/auth.js";
import { imagesRoutes } from "./routes/images.js";
import { authMiddleware } from "./middleware/auth.js";
import type { CompanionSecurityConfig } from "./securityConfig.js";
import { isOriginAllowed } from "./securityConfig.js";

export async function startServer(opts: { port: number; security: CompanionSecurityConfig }) {
  loadSession();

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
  await app.register(pairRoutes, { sessionTtlMs: opts.security.sessionTtlMs });
  await app.register(authRoutes);
  await app.register(imagesRoutes, { security: opts.security });

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: "0.2.0",
      paired: isPaired(),
    };
  });

  await app.listen({ host: "127.0.0.1", port: opts.port });
  console.log(`Companion 服务已启动: http://127.0.0.1:${opts.port}`);
  console.log(`安全渠道: ${opts.security.channel}`);
  console.log("允许的 Origin:");
  opts.security.allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));

  if (!isPaired()) {
    console.log("等待网页端发起配对...");
  }
}
