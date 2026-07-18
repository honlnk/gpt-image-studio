/**
 * 豆包 Seedream（火山方舟 ByteDance）adapter。
 *
 * 走 OpenAI 兼容的 /images/generations 端点，但：
 *   1. size 是「总像素范围 [3.6M, 16M] + 宽高比 [1/16, 16]」双约束，无步长对齐（step=1）
 *   2. 原生支持图生图（SeedEdit），edit 也走 /generations 的 image 字段
 *   3. 固定 response_format=b64_json + watermark=false
 *
 * adapter 本体由 createOpenAICompatibleAdapter 工厂生成，本文件只保留豆包特有的
 * size 规整算法（双像素约束 + 宽高比钳制）。能力数据见 profiles/doubao.json。
 */

import type { SizeConstraints } from "../types.js";
import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";
import { getProviderProfile } from "../providerProfiles.js";

/** 豆包 size 约束（从配置表读，normalizeDoubaoSize 默认参数共用）。 */
const SIZE_CONSTRAINTS: SizeConstraints = getProviderProfile("doubao")!.sizeConstraints;

export const doubaoAdapter = createOpenAICompatibleAdapter({
  id: "doubao",
  fieldMode: "strict",
  requiredFields: { response_format: "b64_json", watermark: false },
  responseShape: "data_b64",
  editMode: "image_field",
  normalizeSize: normalizeDoubaoSize,
});

/**
 * 把 OpenAI 形状的 size 规整成豆包合法的 `宽x高`。
 *
 * 规整策略（豆包双约束）：
 *   1. 宽高比必须在 [1/maxAspectRatio, maxAspectRatio] 内（超了钳到边界）
 *   2. 总像素必须在 [minPixels, maxPixels] 内
 * 无步长对齐（step=1），不像 GLM 需要对齐 32 的倍数。
 */
export function normalizeDoubaoSize(
  size: string,
  constraints: SizeConstraints = SIZE_CONSTRAINTS,
): string {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return constraints.defaultSize;
  }

  let width: number;
  let height: number;

  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints);
    width = dims.width;
    height = dims.height;
  } else {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(trimmed);
    if (match) {
      width = Number(match[1]);
      height = Number(match[2]);
    } else {
      console.warn(`[doubao] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
      return constraints.defaultSize;
    }
  }

  return finalizeSize(width, height, constraints);
}

/** 按比例 + 目标像素（取 maxPixels 与 minPixels 的几何中间值作基准）算出原始尺寸。 */
function dimensionsFromRatio(ratio: string, constraints: SizeConstraints) {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;
  const basePixels = Math.sqrt(constraints.minPixels * constraints.maxPixels);
  const width = Math.round(Math.sqrt(basePixels * aspect));
  const height = Math.round(width / aspect);
  return { width, height };
}

/** 规整到豆包合法：钳宽高比 → 钳总像素范围（双向）。无步长对齐。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  let w = Math.max(constraints.step, Math.round(width));
  let h = Math.max(constraints.step, Math.round(height));

  const maxAspect = constraints.maxAspectRatio;
  if (maxAspect !== null) {
    const aspect = w / h;
    if (aspect > maxAspect) {
      w = Math.round(h * maxAspect);
    } else if (aspect < 1 / maxAspect) {
      h = Math.round(w * maxAspect);
    }
  }

  const clampPixels = (targetPixels: number) => {
    const ratio = Math.sqrt(targetPixels / (w * h));
    w = Math.max(constraints.step, Math.round(w * ratio));
    h = Math.max(constraints.step, Math.round(h * ratio));
  };
  if (w * h > constraints.maxPixels) {
    clampPixels(constraints.maxPixels);
  } else if (w * h < constraints.minPixels) {
    clampPixels(constraints.minPixels);
  }

  return `${w}x${h}`;
}
