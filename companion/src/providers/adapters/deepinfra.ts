/**
 * DeepInfra adapter。
 *
 * DeepInfra 是少数严格兼容 OpenAI Images API 的 provider：走标准
 * /v1/openai/images/{generations,edits} 端点、Bearer 鉴权、响应 data[].b64_json。
 * 唯一约束是强制 response_format=b64_json（传 url 会报错），尺寸须是 32 的倍数。
 *
 * 这是 createOpenAICompatibleAdapter 工厂的典型用例——整个 adapter 除了 size 规整
 * 外没有自定义逻辑，全部由工厂的通用骨架处理。加一个此类 provider 的成本就是
 * 这一个文件 + 一个 profiles json + preset + registry 注册。
 *
 * 协议来源：DeepInfra OpenAI 兼容层文档
 * https://docs.deepinfra.com/api-reference/image-generation/openai-images-generations
 */

import type { SizeConstraints } from "../types.js";
import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";
import { getProviderProfile } from "../providerProfiles.js";

const SIZE_CONSTRAINTS: SizeConstraints = getProviderProfile("deepinfra")!.sizeConstraints;

export const deepinfraAdapter = createOpenAICompatibleAdapter({
  id: "deepinfra",
  fieldMode: "passthrough",
  // DeepInfra 的 response_format 枚举只有 b64_json 一个值（传 url 会报错）
  requiredFields: { response_format: "b64_json" },
  responseShape: "data_b64",
  editMode: "multipart",
  normalizeSize: normalizeDeepInfraSize,
});

/**
 * 把 size 规整成 DeepInfra 合法的 `宽x高`：对齐 32 倍数 + 钳制到 [256, 1440]。
 * DeepInfra 没有 GLM/豆包那种像素总量或宽高比的额外约束，规整最简单。
 */
export function normalizeDeepInfraSize(
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

  console.warn(`[deepinfra] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
  return constraints.defaultSize;
}

/** 按比例 + 目标像素（以 maxPixels 为基准）算出原始尺寸。 */
function dimensionsFromRatio(ratio: string, constraints: SizeConstraints) {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;
  const width = Math.round(Math.sqrt(constraints.maxPixels * aspect));
  const height = Math.round(width / aspect);
  return { width, height };
}

/** 规整到 DeepInfra 合法：对齐 step → 钳制 [min, max]。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  const w = clamp(alignToStep(width, constraints), constraints.min, constraints.max, constraints);
  const h = clamp(alignToStep(height, constraints), constraints.min, constraints.max, constraints);
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
  return alignToStep(Math.min(max, Math.max(min, value)), constraints);
}
