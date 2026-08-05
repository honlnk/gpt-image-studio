import { PROVIDER_PROFILES } from "./providers/providerProfiles.js";

/**
 * login 命令（CLI）和凭证管理面板（Web）共用的 provider 预设视图。
 *
 * 这份列表是"用户选 provider"的单一来源——CLI 的 login 菜单和 Web 面板的
 * provider 下拉都读这里（Web 通过 GET /credentials/presets 拿到）。
 * 实际静态数据来自 providers/profiles/{id}.json，避免默认 URL/model 与能力配置分离。
 */
export type ProviderPreset = {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

/**
 * 从 profile 的 preset 元数据生成对外兼容的预设列表。
 * order 只用于稳定排序，不暴露给 Web/CLI。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = Object.entries(PROVIDER_PROFILES)
  .sort(([, a], [, b]) => a.preset.order - b.preset.order)
  .map(([id, profile]) => ({
    id,
    label: profile.preset.label,
    defaultBaseUrl: profile.preset.defaultBaseUrl,
    defaultModel: profile.preset.defaultModel,
  }));

/**
 * 按 provider id 取预设。adapter 的 describe() / generate() / edit() 用它做
 * `config.model ?? getPreset(id).defaultModel` 的回退，不再各自声明 DEFAULT_*_MODEL。
 * 未配置的 provider id 返回 undefined（由调用方决定回退策略）。
 */
export function getProviderPreset(providerId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === providerId);
}

/**
 * 按 provider id 取默认 model。未配置时返回 undefined。
 * 这是各 adapter `config.model ?? ...` 回退的单一数据源。
 */
export function getDefaultModel(providerId: string): string | undefined {
  return getProviderPreset(providerId)?.defaultModel;
}
