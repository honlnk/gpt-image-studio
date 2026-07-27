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
import {
  alignToStep,
  clampToStep,
  parseSizeInput,
} from "../sizeUtils.js";

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
  const parsed = parseSizeInput(size, constraints);

  if (parsed.auto) {
    return constraints.defaultSize;
  }
  if (parsed.width === undefined || parsed.height === undefined) {
    console.warn(`[deepinfra] 无法识别的 size "${size.trim()}"，回退默认 ${constraints.defaultSize}`);
    return constraints.defaultSize;
  }

  return finalizeSize(parsed.width, parsed.height, constraints);
}

/** 规整到 DeepInfra 合法：对齐 step → 钳制 [min, max]。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  const w = clampToStep(alignToStep(width, constraints), constraints.min, constraints.max, constraints);
  const h = clampToStep(alignToStep(height, constraints), constraints.min, constraints.max, constraints);
  return `${w}x${h}`;
}
