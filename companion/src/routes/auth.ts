import type { FastifyInstance } from "fastify";
import type { CompanionAuthStatus } from "../types.js";
import { getActiveCredential } from "../credentials.js";
import { resolveAdapter } from "../providers/registry.js";
import { openaiAdapter } from "../providers/adapters/openai.js";
import type { ProviderConfig } from "../providers/types.js";

/** 无凭据时回流的默认能力/约束/档位，取 OpenAI（web 默认 UI 行为）。 */
const OPENAI_DEFAULT_CAPABILITY = openaiAdapter.capability;
const OPENAI_DEFAULT_SIZE_CONSTRAINTS = openaiAdapter.sizeConstraints;
const OPENAI_DEFAULT_RESOLUTION_OPTIONS = openaiAdapter.resolutionOptions;

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Reply: CompanionAuthStatus }>("/auth/status", async () => {
    // 损坏探测由 /credentials 负责（它返 500+corrupt，Web 在 credError 通道展示）。
    // 这里用 getActiveCredential：它内部 catch CredentialStoreError 返 null，
    // 让本路由走「无凭据」正常分支。这样即使 /credentials 已经把损坏文件备份走，
    // /auth/status 仍能正常返 ready:false，不会因文件消失而异常。
    const creds = getActiveCredential();
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

    // provider 未注册（拼写错 / 已删除）：走和「无凭据」一致的降级——返 ready:false +
    // OpenAI 默认能力让 UI 能正常渲染。真正的「配置错误」提示由 images route 在用户
    // 发起请求时返 503 给出（/auth/status 是连接健康检查端点，不在这里加 error 字段）。
    if (!adapter) {
      return {
        provider: creds.provider, // 保留真实 provider 让用户能看到自己填的是什么
        mode: "api_key" as const,
        ready: false,
        accountLabel: creds.label,
        model: creds.model,
        capability: OPENAI_DEFAULT_CAPABILITY,
        sizeConstraints: OPENAI_DEFAULT_SIZE_CONSTRAINTS,
        resolutionOptions: OPENAI_DEFAULT_RESOLUTION_OPTIONS,
      };
    }

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
