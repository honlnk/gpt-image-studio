/**
 * Provider adapter 共用的尺寸规整原料函数。
 *
 * 各 provider 的 `normalizeXxxSize` 在以下三件事上高度同构：
 *   1. 入口解析：auto / "" / "W:H" / "WxH" 四种分支
 *   2. 按比例算原始尺寸：从 ratio 推 width/height（基准像素策略不同 → 用 basePixels 参数区分）
 *   3. 对齐 step / 钳制 [min,max]
 *
 * 但每个 provider 的 `finalizeSize`（像素压缩、宽高比钳制、循环减步长等）逻辑各异，
 * 保留在各 adapter 文件里——这是它们的核心差异点，不应强行统一。
 *
 * 本模块只提供"原料"，让 adapter 的 finalizeSize 调用这些基础工具。
 */

import type { SizeConstraints } from "./types.js";

/** Size 输入解析结果。 */
export type ParsedSize = {
  /** "auto" 或空字符串。 */
  auto: true;
  size: undefined;
  width: undefined;
  height: undefined;
} | {
  auto: false;
  /** 无法识别（不匹配 auto / ratio / WxH），调用方回退 defaultSize。 */
  size: undefined;
  width: undefined;
  height: undefined;
} | {
  auto: false;
  size: undefined;
  width: number;
  height: number;
};

/**
 * 解析 size 输入字符串的统一入口。
 *
 * 匹配顺序与各 adapter 历史实现一致：
 *   1. "auto" / "" → auto
 *   2. 含 ":" → ratio 分支（调用方拿到 width/height 后用自己的 dimensionsFromRatio 算）
 *      注意：本函数对 ratio 分支也直接算出 width/height（用 basePixels 策略），
 *      调用方拿到后可直接喂 finalizeSize。
 *   3. 匹配 WxH / W×H → width/height
 *   4. 其它 → 无法识别
 *
 * DashScope 系（qwen/wan）还接受 `W*H`，用 allowStarSeparator 开关。
 */
export function parseSizeInput(
  size: string,
  constraints: SizeConstraints,
  options: {
    /** 比例分支算原始尺寸时的基准像素策略。 */
    basePixelsStrategy?: "maxPixels" | "geoMean" | "minOfMaxAndSqrtMaxPixels";
    /** 是否接受 `W*H` 作为分隔符（DashScope 系）。 */
    allowStarSeparator?: boolean;
  } = {},
): ParsedSize {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return { auto: true, size: undefined, width: undefined, height: undefined };
  }

  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints, options.basePixelsStrategy ?? "maxPixels");
    return { auto: false, size: undefined, width: dims.width, height: dims.height };
  }

  const separatorPattern = options.allowStarSeparator ? "[x×*]" : "[x×]";
  const match = new RegExp(`^(\\d+)\\s*${separatorPattern}\\s*(\\d+)$`, "i").exec(trimmed);
  if (match) {
    return { auto: false, size: undefined, width: Number(match[1]), height: Number(match[2]) };
  }

  return { auto: false, size: undefined, width: undefined, height: undefined };
}

/**
 * 按比例 + 基准像素算出原始 width / height。
 *
 * basePixelsStrategy 区分三种历史实现：
 *   - "maxPixels"（默认，deepinfra/qwen/wan）：basePixels = maxPixels
 *   - "geoMean"（doubao）：basePixels = sqrt(minPixels * maxPixels)
 *   - "minOfMaxAndSqrtMaxPixels"（glm）：baseSide = min(max, sqrt(maxPixels))
 */
export function dimensionsFromRatio(
  ratio: string,
  constraints: SizeConstraints,
  basePixelsStrategy: "maxPixels" | "geoMean" | "minOfMaxAndSqrtMaxPixels" = "maxPixels",
): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;

  if (basePixelsStrategy === "geoMean") {
    const basePixels = Math.sqrt(constraints.minPixels * constraints.maxPixels);
    const width = Math.round(Math.sqrt(basePixels * aspect));
    return { width, height: Math.round(width / aspect) };
  }

  if (basePixelsStrategy === "minOfMaxAndSqrtMaxPixels") {
    const baseSide = Math.min(constraints.max, Math.sqrt(constraints.maxPixels));
    const width = Math.round(baseSide * Math.sqrt(aspect));
    return { width, height: Math.round(width / aspect) };
  }

  // "maxPixels"
  const width = Math.round(Math.sqrt(constraints.maxPixels * aspect));
  return { width, height: Math.round(width / aspect) };
}

/** 简单 step 对齐：Math.round(value/step)*step（不加 Math.max(step, ...) 下限）。 */
export function alignToStep(value: number, constraints: SizeConstraints): number {
  return Math.round(value / constraints.step) * constraints.step;
}

/** step 对齐 + 至少为 step（DashScope 系 qwen/wan 用这个变体）。 */
export function alignToStepAtLeastMin(value: number, constraints: SizeConstraints): number {
  return Math.max(constraints.step, Math.round(value / constraints.step) * constraints.step);
}

/** 对齐 step 后钳制到 [min, max]（用 alignToStep，不加下限保护）。 */
export function clampToStep(
  value: number,
  min: number,
  max: number,
  constraints: SizeConstraints,
): number {
  return alignToStep(Math.min(max, Math.max(min, value)), constraints);
}

/** 对齐 step（至少 step）后钳制到 [min, max]（DashScope 系用这个变体）。 */
export function clampToStepAtLeastMin(
  value: number,
  min: number,
  max: number,
  constraints: SizeConstraints,
): number {
  return alignToStepAtLeastMin(Math.min(max, Math.max(min, value)), constraints);
}

/**
 * 把 `WxH` 形状转成 DashScope 用的 `W*H`（qwen/wan 共用）。
 */
export function toDashScopeSize(size: string): string {
  return size.replace(/[x×]/i, "*");
}

/**
 * 在循环减步长压缩像素时，按"长边优先"减一步。
 *
 * 多个 provider（glm/qwen/wan）的 finalizeSize 都有这段循环逻辑，结构一致。
 */
export function shrinkLongestSideByStep(
  width: number,
  height: number,
  constraints: SizeConstraints,
  align: (value: number, c: SizeConstraints) => number = alignToStep,
): { width: number; height: number } {
  if (width >= height) {
    return { width: align(width - constraints.step, constraints), height };
  }
  return { width, height: align(height - constraints.step, constraints) };
}
