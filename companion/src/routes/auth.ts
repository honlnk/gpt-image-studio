import type { FastifyInstance } from "fastify";
import type { CompanionAuthStatus } from "../types.js";
import { loadCredentials, maskApiKey } from "../credentials.js";
import { resolveAdapter } from "../providers/registry.js";
import { openaiAdapter } from "../providers/openai.js";
import type { ProviderConfig } from "../providers/types.js";

/** 无凭据时回流的默认能力/约束/档位，取 OpenAI（web 默认 UI 行为）。 */
const OPENAI_DEFAULT_CAPABILITY = openaiAdapter.capability;
const OPENAI_DEFAULT_SIZE_CONSTRAINTS = openaiAdapter.sizeConstraints;
const OPENAI_DEFAULT_RESOLUTION_OPTIONS = openaiAdapter.resolutionOptions;

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Reply: CompanionAuthStatus }>("/auth/status", async () => {
    const creds = loadCredentials();
    if (!creds) {
      return {
        provider: "openai",
        mode: "api_key" as const,
        ready: false,
        accountLabel: "",
        // 无凭据时仍回流 OpenAI 默认能力/约束/档位，web 能正常渲染默认 UI
        model: "",
        capability: OPENAI_DEFAULT_CAPABILITY,
        sizeConstraints: OPENAI_DEFAULT_SIZE_CONSTRAINTS,
        resolutionOptions: OPENAI_DEFAULT_RESOLUTION_OPTIONS,
      };
    }

    const config: ProviderConfig = {
      provider: creds.provider ?? "openai",
      apiBaseUrl: creds.apiBaseUrl,
      apiKey: creds.apiKey,
      model: creds.model,
    };
    const adapter = resolveAdapter(config);

    return {
      provider: adapter.id,
      mode: "api_key" as const,
      ready: true,
      accountLabel: maskApiKey(creds.apiKey),
      model: creds.model ?? "",
      capability: adapter.capability,
      sizeConstraints: adapter.sizeConstraints,
      resolutionOptions: adapter.resolutionOptions,
    };
  });
}

// 直接引用 openai adapter 的静态值作为「无凭据」回退。
// 不走 resolveAdapter 是因为无凭据时不该构造 ProviderConfig；这里只是要默认值展示。
