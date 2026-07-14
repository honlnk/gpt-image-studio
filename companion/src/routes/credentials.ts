import type { FastifyInstance } from "fastify";
import type {
  CompanionCredentialsView,
  CompanionCredentialsSaveRequest,
  CompanionCredentialsSaveResponse,
  CompanionCredentialsClearResponse,
} from "../types.js";
import type { ProviderPreset } from "../providerPresets.js";
import { PROVIDER_PRESETS } from "../providerPresets.js";
import { loopbackGuard } from "../middleware/loopback.js";
import { loadCredentials, saveCredentials, clearCredentials, maskApiKey } from "../credentials.js";

/**
 * 凭证管理路由（Web 面板专用，替代 CLI `gpt-image-studio login`）。
 *
 * 鉴权：用 loopbackGuard（onRequest）而非配对 session token——
 * 因为凭证管理发生在配对之前（首次需要先填 key 才有意义配对）。
 * loopbackGuard 保证只有本机浏览器/CLI 能写凭证，等同 `login` 命令的信任模型。
 *
 * 注册顺序注意（见 server.ts）：本 plugin 必须在 authMiddleware 之前注册，
 * 否则 `/credentials/*` 会被 bearer token 守卫拦成 401。
 */
export async function credentialsRoutes(app: FastifyInstance) {
  // plugin 内最先注册守卫：本 plugin 所有路由都受 loopback 约束。
  await loopbackGuard(app);

  app.get<{ Reply: ProviderPreset[] }>("/credentials/presets", async () => {
    return PROVIDER_PRESETS;
  });

  app.get<{ Reply: CompanionCredentialsView }>("/credentials", async () => {
    const creds = loadCredentials();
    if (!creds) {
      return { hasApiKey: false, accountLabel: "" };
    }
    return {
      hasApiKey: true,
      provider: creds.provider,
      apiBaseUrl: creds.apiBaseUrl,
      model: creds.model,
      accountLabel: maskApiKey(creds.apiKey),
      savedAt: creds.savedAt,
    };
  });

  app.post<{
    Body: CompanionCredentialsSaveRequest;
    Reply: CompanionCredentialsSaveResponse;
  }>("/credentials", async (req, reply) => {
    const { provider, apiBaseUrl, apiKey, model } = (req.body ?? {}) as CompanionCredentialsSaveRequest;
    if (!apiBaseUrl || !apiKey) {
      return reply.status(400).send({ error: "apiBaseUrl 和 apiKey 不能为空" } as never);
    }
    saveCredentials(apiBaseUrl, apiKey.trim(), { provider, model });
    return { ok: true, accountLabel: maskApiKey(apiKey.trim()) };
  });

  app.delete<{ Reply: CompanionCredentialsClearResponse }>("/credentials", async () => {
    clearCredentials();
    return { ok: true };
  });
}
