export const FIXED_IMAGE_MODEL = "gpt-image-2";

/**
 * 直连模式可选的图片模型。GPT Image 2.5（2026-09-08 发布）分两个档位：
 * Flare 为快速档（官方默认推荐，较 gpt-image-2 延迟低 50%），Sunburst 为
 * 高精度编辑档（生成更慢）。端点与参数形状与 gpt-image-2 一致，请求层无需分支。
 */
export const DIRECT_IMAGE_MODEL_OPTIONS = [
  { value: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
  { value: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
  { value: "gpt-image-2", label: "GPT Image 2" },
] as const;

export type DirectImageModel = (typeof DIRECT_IMAGE_MODEL_OPTIONS)[number]["value"];

export function normalizeDirectImageModel(value: unknown): DirectImageModel {
  return DIRECT_IMAGE_MODEL_OPTIONS.some((option) => option.value === value)
    ? (value as DirectImageModel)
    : FIXED_IMAGE_MODEL;
}
