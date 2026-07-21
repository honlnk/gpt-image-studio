import type { FastifyInstance } from "fastify";
import type { CompanionAuthStatus } from "../types.js";
import { CredentialStoreError, listCredentials } from "../credentials.js";
import { resolveAdapter } from "../providers/registry.js";
import { openaiAdapter } from "../providers/adapters/openai.js";
import type { ProviderConfig } from "../providers/types.js";

/** 无凭据时回流的默认能力/约束/档位，取 OpenAI（web 默认 UI 行为）。 */
const OPENAI_DEFAULT_CAPABILITY = openaiAdapter.capability;
const OPENAI_DEFAULT_SIZE_CONSTRAINTS = openaiAdapter.sizeConstraints;
const OPENAI_DEFAULT_RESOLUTION_OPTIONS = openaiAdapter.resolutionOptions;

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Reply: CompanionAuthStatus }>("/auth/status", async () => {
    // 直接调 listCredentials（=loadStore）一次性拿到完整 store；损坏时抛
    // CredentialStoreError。返 200 + corrupt:true 让 Web 在 authStatus 通道也能
    // 拿到损坏信号（与 /credentials 的 500+corrupt 互为双保险）。不返 500 是因为
    // Web 端 getCompanionAuthStatusResult 对非 200 的处理是「静默置空」，会丢失原因。
    let store;
    try {
      store = listCredentials();
    } catch (error) {
      if (error instanceof CredentialStoreError) {
        return {
          provider: "openai",
          mode: "api_key" as const,
          ready: false,
          accountLabel: "",
          model: "",
          capability: OPENAI_DEFAULT_CAPABILITY,
          sizeConstraints: OPENAI_DEFAULT_SIZE_CONSTRAINTS,
          resolutionOptions: OPENAI_DEFAULT_RESOLUTION_OPTIONS,
          corrupt: true,
          error: error.message,
        };
      }
      throw error;
    }

    const creds = store.activeId ? store.entries.find((e) => e.id === store.activeId) ?? null : null;
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
      provider: creds.provider,
      apiBaseUrl: creds.apiBaseUrl,
      apiKey: creds.apiKey,
      model: creds.model || undefined,
    };
    const adapter = resolveAdapter(config);

    return {
      provider: adapter.id,
      mode: "api_key" as const,
      ready: true,
      accountLabel: creds.label,
      model: creds.model,
      capability: adapter.capability,
      sizeConstraints: adapter.getSizeConstraints?.(config) ?? adapter.sizeConstraints,
      resolutionOptions: adapter.getResolutionOptions?.(config) ?? adapter.resolutionOptions,
    };
  });
}

// 直接引用 openai adapter 的静态值作为「无凭据」回退。
// 不走 resolveAdapter 是因为无凭据时不该构造 ProviderConfig；这里只是要默认值展示。
