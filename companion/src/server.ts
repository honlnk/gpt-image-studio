import Fastify from "fastify";
import cors from "@fastify/cors";
import type { CompanionHealthResponse } from "@gpt-image-studio/protocol";
import { loadSession, isPaired } from "./pairingState";
import { pairRoutes } from "./routes/pair";
import { authMiddleware } from "./middleware/auth";

export async function startServer(opts: { port: number }) {
  loadSession();

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: [
      "https://gpt-image.honlnk.com",
      "http://127.0.0.1:8888",
      "http://localhost:8888",
    ],
    credentials: true,
  });

  await authMiddleware(app);
  await app.register(pairRoutes);

  app.get("/health", async (): Promise<CompanionHealthResponse> => {
    return {
      app: "gpt-image-studio-companion",
      version: "0.0.0",
      paired: isPaired(),
    };
  });

  await app.listen({ host: "127.0.0.1", port: opts.port });
  console.log(`Companion 服务已启动: http://127.0.0.1:${opts.port}`);

  if (!isPaired()) {
    console.log("等待网页端发起配对...");
  }
}
