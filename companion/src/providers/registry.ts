import type { ProviderAdapter, ProviderConfig } from "./types.js";
import { openaiAdapter } from "./openai.js";
import { glmAdapter } from "./glm.js";
import { doubaoAdapter } from "./doubao.js";

/**
 * 已注册的 adapter 表。key = provider id（与 credentials.json 的 provider 字段对齐）。
 * 后续再加 qwen/wan 在这里注册。
 */
const REGISTRY: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  glm: glmAdapter,
  doubao: doubaoAdapter,
};

/** 默认 provider。credentials 缺 provider 字段、或 provider 未注册时回退到它。 */
const DEFAULT_PROVIDER_ID = "openai";

/**
 * 从 ProviderConfig 解析对应的 adapter。
 *
 * - 无 provider 字段 → 默认 openai（兼容老 credentials.json，现有用户零感知）。
 * - provider 未注册（拼写错 / 还没实现的 provider）→ 回退 openai + 记录，
 *   不直接抛错，避免 companion 启动或单次请求硬失败。
 *   这种情况下 capability 是 openai 的全能力，行为退化但不中断。
 *
 * 真正的「该 provider 不支持编辑」这类错误由 route 层按 capability 判断返回，
 * 不在这里抛——因为 resolveAdapter 的职责只是「选出 adapter」，不含语义判断。
 */
export function resolveAdapter(config: ProviderConfig): ProviderAdapter {
  const id = config.provider ?? DEFAULT_PROVIDER_ID;
  const adapter = REGISTRY[id];
  if (adapter) return adapter;

  console.warn(
    `[companion] 未注册的 provider "${id}"，回退到默认 "${DEFAULT_PROVIDER_ID}"。` +
      `若是有意为之，请在 registry.ts 注册对应 adapter。`,
  );
  return REGISTRY[DEFAULT_PROVIDER_ID];
}

/** 列出所有已注册 provider id（供 CLI providers 命令、login 选项等使用）。 */
export function listProviderIds(): string[] {
  return Object.keys(REGISTRY);
}
