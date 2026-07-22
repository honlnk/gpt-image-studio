import type { ProviderAdapter, ProviderConfig } from "./types.js";
import { openaiAdapter } from "./adapters/openai.js";
import { glmAdapter } from "./adapters/glm.js";
import { doubaoAdapter } from "./adapters/doubao.js";
import { grokAdapter } from "./adapters/grok.js";
import { qwenAdapter } from "./adapters/qwen.js";
import { wanAdapter } from "./adapters/wan.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { deepinfraAdapter } from "./adapters/deepinfra.js";

/**
 * 已注册的 adapter 表。key = provider id（与 credentials.json 的 provider 字段对齐）。
 * 后续再加 provider 在这里注册。
 */
const REGISTRY: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  glm: glmAdapter,
  doubao: doubaoAdapter,
  qwen: qwenAdapter,
  wan: wanAdapter,
  grok: grokAdapter,
  gemini: geminiAdapter,
  deepinfra: deepinfraAdapter,
};

/** 默认 provider。credentials 缺 provider 字段时回退到它（兼容老 credentials.json）。 */
const DEFAULT_PROVIDER_ID = "openai";

/**
 * 从 ProviderConfig 解析对应的 adapter。
 *
 * - 无 provider 字段（空串）→ 默认 openai（兼容老 credentials.json，现有用户零感知）。
 * - provider 未注册（拼写错 / 已删除 / 还没实现）→ 返 null，由调用方决定如何报错。
 *   不再静默回退 openai——那会让 /auth/status 上报错的 capability，images route 用错的
 *   请求形状发到用户的 apiBaseUrl，用户只看到难懂的上游错误。
 *
 * 真正的「该 provider 不支持编辑」这类错误由 route 层按 capability 判断返回，
 * 不在这里抛——因为 resolveAdapter 的职责只是「选出 adapter」，不含语义判断。
 */
export function resolveAdapter(config: ProviderConfig): ProviderAdapter | null {
  const id = config.provider ?? DEFAULT_PROVIDER_ID;
  return REGISTRY[id] ?? null;
}

/** provider id 是否已注册（供 credentials 写入校验、CLI 校验等使用）。 */
export function isRegisteredProvider(id: string): boolean {
  return id in REGISTRY;
}

/** 列出所有已注册 provider id（供 CLI providers 命令、login 选项等使用）。 */
export function listProviderIds(): string[] {
  return Object.keys(REGISTRY);
}
