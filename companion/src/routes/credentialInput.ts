import type { CompanionCredentialInput } from "../types.js";
import { isRegisteredProvider, listProviderIds } from "../providers/registry.js";

/**
 * 凭据输入的容错解析 + 校验，供 /credentials/*（loopbackGuard）和
 * /admin/credentials/*（ADMIN_API_KEY）两套路由共用，避免校验逻辑漂移。
 */

/** 容错解析请求体为 CompanionCredentialInput（缺字段补 undefined/空串）。 */
export function parseCredentialInput(body: unknown): CompanionCredentialInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    label: typeof b.label === "string" ? b.label : undefined,
    provider: typeof b.provider === "string" ? b.provider : undefined,
    apiBaseUrl: typeof b.apiBaseUrl === "string" ? b.apiBaseUrl : "",
    apiKey: typeof b.apiKey === "string" ? b.apiKey : "",
    model: typeof b.model === "string" ? b.model : undefined,
  };
}

/** 校验输入，返回错误文案或 null（通过）。 */
export function validateCredentialInput(input: CompanionCredentialInput): string | null {
  if (!input.apiBaseUrl.trim()) return "apiBaseUrl 不能为空";
  if (!input.apiKey.trim()) return "apiKey 不能为空";
  // 明确传了 provider 但不在注册表里 → 拒绝（拼写错 / 已删除的 provider 不能静默存下来）
  if (
    input.provider !== undefined &&
    input.provider.trim() !== "" &&
    !isRegisteredProvider(input.provider.trim())
  ) {
    const valid = listProviderIds().sort().join(", ");
    return `未知的 provider "${input.provider.trim()}"，已注册的有：${valid}`;
  }
  return null;
}
