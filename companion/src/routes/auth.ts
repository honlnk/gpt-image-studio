import type { FastifyInstance } from "fastify";
import type { CompanionAuthStatus } from "@gpt-image-studio/protocol";
import { loadCredentials, maskApiKey } from "../credentials";

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Reply: CompanionAuthStatus }>("/auth/status", async () => {
    const creds = loadCredentials();
    if (!creds) {
      return {
        provider: "openai",
        mode: "api_key" as const,
        ready: false,
        accountLabel: "",
      };
    }
    return {
      provider: "openai",
      mode: "api_key" as const,
      ready: true,
      accountLabel: maskApiKey(creds.apiKey),
    };
  });
}
