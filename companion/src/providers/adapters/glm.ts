/**
 * GLM-Image（智谱 Zhipu）adapter。
 *
 * 走智谱 OpenAI 兼容路径，请求体只认 { model, prompt, size }，但返回的是
 * data[0].url（有时效），要立即 fetch 转 b64——因此请求端兼容 OpenAI，响应端不兼容。
 * 不支持编辑（capability.edit=false），带图编辑请求由 route 层返回 501。
 *
 * adapter 本体由 createOpenAICompatibleAdapter 工厂生成，本文件只保留 GLM 特有的
 * size 规整算法（32 步长对齐 + 像素上限压缩）。能力数据见 profiles/glm.json。
 */

import type { SizeConstraints } from "../types.js";
import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";
import { getProviderProfile } from "../providerProfiles.js";

/** GLM size 约束（从配置表读，normalizeGlmSize 默认参数共用）。 */
const SIZE_CONSTRAINTS: SizeConstraints = getProviderProfile("glm")!.sizeConstraints;

export const glmAdapter = createOpenAICompatibleAdapter({
  id: "glm",
  fieldMode: "strict",
  responseShape: "data_url",
  editMode: "none",
  normalizeSize: normalizeGlmSize,
});

/**
 * 把 OpenAI 形状的 size 规整成 GLM 合法的 `宽x高`（小写 x）。
 *
 * 规整策略（GLM 4 条硬规则）：
 *   1. 对齐 step（32）倍数
 *   2. 钳制到 [min, max]（512–2048）
 *   3. 压到 maxPixels（4194304）以内：长边优先缩
 *   4. 小写 x 分隔
 */
export function normalizeGlmSize(
  size: string,
  constraints: SizeConstraints = SIZE_CONSTRAINTS,
): string {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return constraints.defaultSize;
  }

  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints);
    return finalizeSize(dims.width, dims.height, constraints);
  }

  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(trimmed);
  if (match) {
    return finalizeSize(Number(match[1]), Number(match[2]), constraints);
  }

  console.warn(`[glm] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
  return constraints.defaultSize;
}

/** 按比例 + 目标像素（取 maxPixels 的一半作基准，接近正方形默认）算出原始尺寸。 */
function dimensionsFromRatio(ratio: string, constraints: SizeConstraints) {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;
  const baseSide = Math.min(constraints.max, Math.sqrt(constraints.maxPixels));
  const width = Math.round(baseSide * Math.sqrt(aspect));
  const height = Math.round(width / aspect);
  return { width, height };
}

/** 规整到 GLM 合法：对齐 step → 钳制范围 → 压像素。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  let w = alignToStep(width, constraints);
  let h = alignToStep(height, constraints);

  w = clamp(w, constraints.min, constraints.max, constraints);
  h = clamp(h, constraints.min, constraints.max, constraints);

  while (w * h > constraints.maxPixels && w > constraints.min && h > constraints.min) {
    if (w >= h) {
      w = alignToStep(w - constraints.step, constraints);
    } else {
      h = alignToStep(h - constraints.step, constraints);
    }
  }

  return `${w}x${h}`;
}

function alignToStep(value: number, constraints: SizeConstraints): number {
  return Math.round(value / constraints.step) * constraints.step;
}

function clamp(
  value: number,
  min: number,
  max: number,
  constraints: SizeConstraints,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  return alignToStep(clamped, constraints);
}
