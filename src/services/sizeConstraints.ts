import type { ApiMode, GenerationParams } from "../types/studio";

/**
 * 尺寸软约束。与 companion 的 SizeConstraints 结构一致（本地定义，
 * 避免 imagesApi 反向依赖 companion 类型）。getCustomSizeError 据此动态校验。
 */
export type SizeConstraints = {
  step: number;
  min: number;
  max: number;
  maxPixels: number;
  minPixels: number;
  maxAspectRatio: number | null;
  defaultSize: string;
};

/** OpenAI/gpt-image-2 默认尺寸约束。调用方未传 sizeConstraints 时兜底。 */
export const DEFAULT_SIZE_CONSTRAINTS: SizeConstraints = {
  step: 16,
  min: 16,
  max: 3840,
  maxPixels: 8294400,
  minPixels: 655360,
  maxAspectRatio: 3,
  defaultSize: "1024x1024",
};

/** 把 GenerationParams.size 翻译成 provider 接受的 size 字符串。 */
export function apiSize(params: GenerationParams, c: SizeConstraints) {
  if (params.size === "auto") {
    return "auto";
  }

  if (params.size.includes(":") || params.size === "custom") {
    validateCustomSize(params.width, params.height, c);
    return `${params.width}x${params.height}`;
  }

  return params.size;
}

/**
 * 请求路径兜底：provider 不支持透明背景时，禁止发 transparent。
 * 以 capability（supportsTransparent）为准，而非 model 名字——model 跟随 companion
 * 后不再固定，capability 才是「该 provider 能不能」的真实来源。
 */
export function validateBackground(
  model: string,
  background: GenerationParams["background"],
  apiMode: ApiMode | undefined,
  supportsTransparent: boolean,
) {
  if ((apiMode ?? "images") === "images" && !supportsTransparent && background === "transparent") {
    throw new Error(
      `${model} 当前不支持透明背景，请选择自动或不透明背景。`,
    );
  }
}

function validateCustomSize(width: number, height: number, c: SizeConstraints) {
  const error = getCustomSizeError(width, height, c);
  if (error) {
    throw new Error(error);
  }
}

export function getCustomSizeError(width: number, height: number, c: SizeConstraints) {
  const normalizedWidth = Math.trunc(width);
  const normalizedHeight = Math.trunc(height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    normalizedWidth !== width ||
    normalizedHeight !== height
  ) {
    return "自定义尺寸的宽高必须是整数。";
  }

  if (
    normalizedWidth < c.min ||
    normalizedHeight < c.min ||
    normalizedWidth > c.max ||
    normalizedHeight > c.max ||
    normalizedWidth % c.step !== 0 ||
    normalizedHeight % c.step !== 0
  ) {
    return `自定义尺寸的宽高必须是 ${c.min} 到 ${c.max} 之间的 ${c.step} 的倍数。`;
  }

  const pixels = normalizedWidth * normalizedHeight;
  if (pixels < c.minPixels || pixels > c.maxPixels) {
    return `自定义尺寸的总像素必须在 ${c.minPixels.toLocaleString()} 到 ${c.maxPixels.toLocaleString()} 之间。`;
  }

  if (c.maxAspectRatio !== null) {
    const longSide = Math.max(normalizedWidth, normalizedHeight);
    const shortSide = Math.min(normalizedWidth, normalizedHeight);
    if (longSide / shortSide > c.maxAspectRatio) {
      return `自定义尺寸的长边与短边比例不能超过 ${c.maxAspectRatio}:1。`;
    }
  }

  return "";
}
