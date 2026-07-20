import {
  buildDashScopeGenerationUrl,
  dataUrlFromImage,
  parseDashScopeResponse,
} from "../dashscope.js";
import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCallOptions,
  ProviderConfig,
  SizeConstraints,
} from "../types.js";
import { urlToB64 } from "../urlToB64.js";
import { getProviderProfile } from "../providerProfiles.js";
import { postJson } from "../providerHttp.js";
import { getDefaultModel } from "../../providerPresets.js";

const QWEN_PROFILE = getProviderProfile("qwen")!;
const DEFAULT_MODEL = getDefaultModel("qwen")!;

/**
 * Qwen-Image（阿里通义千问团队）adapter。
 *
 * Qwen-Image 走 DashScope multimodal-generation 同步接口：
 *   POST /api/v1/services/aigc/multimodal-generation/generation
 *
 * 返回结果是 message.content[] 里的图片 URL。Companion 立即下载并转成
 * OpenAI Images API 兼容的 b64_json，Web 侧无需理解 DashScope 形状。
 *
 * 能力数据（capability / sizeConstraints / resolutionOptions）见
 * providerProfiles.ts 的 qwen 条目。
 */

/** Qwen size 约束（从配置表读，normalizeQwenSize 默认参数共用）。 */
const SIZE_CONSTRAINTS: SizeConstraints = QWEN_PROFILE.sizeConstraints;
const MAX_EDIT_IMAGES = QWEN_PROFILE.editConstraints?.maxImages;

export const qwenAdapter: ProviderAdapter = {
  id: "qwen",
  capability: QWEN_PROFILE.capability,
  sizeConstraints: QWEN_PROFILE.sizeConstraints,
  resolutionOptions: QWEN_PROFILE.resolutionOptions,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_MODEL, providerId: "qwen" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_MODEL;
    const size = normalizeQwenSize(request.size, SIZE_CONSTRAINTS);

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      {
        model,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: request.prompt }],
            },
          ],
        },
        parameters: { size },
      },
      options,
    );

    const imageUrl = await parseDashScopeResponse(
      response,
      "Qwen-Image 响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl, {
      signal: options?.signal,
    });
    return { b64Json, mimeType };
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Qwen-Image 图像编辑需要至少一张参考图。");
    }
    if (MAX_EDIT_IMAGES !== undefined && request.images.length > MAX_EDIT_IMAGES) {
      throw new Error(`Qwen-Image 图像编辑最多支持 ${MAX_EDIT_IMAGES} 张参考图。`);
    }

    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_MODEL;
    const size = normalizeQwenSize(request.size, SIZE_CONSTRAINTS);

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      {
        model,
        input: {
          messages: [
            {
              role: "user",
              content: [
                ...request.images.map((image) => ({
                  image: dataUrlFromImage(image),
                })),
                { text: request.prompt },
              ],
            },
          ],
        },
        parameters: { size },
      },
      options,
    );

    const imageUrl = await parseDashScopeResponse(
      response,
      "Qwen-Image 编辑响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl, {
      signal: options?.signal,
    });
    return { b64Json, mimeType };
  },
};

/**
 * 把 OpenAI 形状的 size 规整成 DashScope Qwen-Image 接口使用的 `宽*高`。
 */
export function normalizeQwenSize(
  size: string,
  constraints: SizeConstraints = SIZE_CONSTRAINTS,
): string {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return toDashScopeSize(constraints.defaultSize);
  }

  let width: number;
  let height: number;

  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints);
    width = dims.width;
    height = dims.height;
  } else {
    const match = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(trimmed);
    if (!match) {
      console.warn(`[qwen] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
      return toDashScopeSize(constraints.defaultSize);
    }
    width = Number(match[1]);
    height = Number(match[2]);
  }

  return finalizeSize(width, height, constraints);
}

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

function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  let w = alignToStep(width, constraints);
  let h = alignToStep(height, constraints);

  w = clamp(w, constraints.min, constraints.max, constraints);
  h = clamp(h, constraints.min, constraints.max, constraints);

  const scalePixels = (targetPixels: number) => {
    const ratio = Math.sqrt(targetPixels / (w * h));
    w = alignToStep(w * ratio, constraints);
    h = alignToStep(h * ratio, constraints);
    w = clamp(w, constraints.min, constraints.max, constraints);
    h = clamp(h, constraints.min, constraints.max, constraints);
  };

  if (w * h > constraints.maxPixels) {
    scalePixels(constraints.maxPixels);
  } else if (w * h < constraints.minPixels) {
    scalePixels(constraints.minPixels);
  }

  while (w * h > constraints.maxPixels && w > constraints.min && h > constraints.min) {
    if (w >= h) {
      w = alignToStep(w - constraints.step, constraints);
    } else {
      h = alignToStep(h - constraints.step, constraints);
    }
  }

  return `${w}*${h}`;
}

function toDashScopeSize(size: string): string {
  return size.replace(/[x×]/i, "*");
}

function alignToStep(value: number, constraints: SizeConstraints): number {
  return Math.max(constraints.step, Math.round(value / constraints.step) * constraints.step);
}

function clamp(
  value: number,
  min: number,
  max: number,
  constraints: SizeConstraints,
): number {
  return alignToStep(Math.min(max, Math.max(min, value)), constraints);
}
