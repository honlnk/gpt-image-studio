/**
 * login 命令（CLI）和凭证管理面板（Web）共用的 provider 预设：
 * 每个 provider 的默认 base url + 默认 model + 简介。
 *
 * 这份列表是"用户选 provider"的单一来源——CLI 的 login 菜单和 Web 面板的
 * provider 下拉都读这里（Web 通过 GET /credentials/presets 拿到）。
 * 新增 provider 时：先在 registry 注册 adapter，再在这里加一项预设即可。
 */
export type ProviderPreset = {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI 兼容（gpt-image-2 / 中转站）",
    defaultBaseUrl: "https://api.packyapi.com/v1/images",
    defaultModel: "gpt-image-2",
  },
  {
    id: "glm",
    label: "GLM-Image（智谱 Zhipu）",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4/images",
    defaultModel: "glm-image",
  },
  {
    id: "doubao",
    label: "豆包 Seedream（火山方舟 ByteDance）",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images",
    defaultModel: "doubao-seedream-5-0-lite",
  },
  {
    id: "qwen",
    label: "Qwen-Image（阿里云百炼 DashScope）",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
    defaultModel: "qwen-image-2.0-pro",
  },
  {
    id: "wan",
    label: "通义万相 Wan（阿里云百炼 DashScope）",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
    defaultModel: "wan2.7-image",
  },
  {
    id: "grok",
    label: "Grok Imagine（xAI）",
    defaultBaseUrl: "https://api.x.ai/v1/images",
    defaultModel: "grok-imagine-image",
  },
  {
    id: "gemini",
    label: "Gemini Image（Google）",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash-image",
  },
];
