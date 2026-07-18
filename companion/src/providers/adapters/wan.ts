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
  ProviderConfig,
  SizeConstraints,
} from "../types.js";
import { urlToB64 } from "../urlToB64.js";
import { getProviderProfile } from "../providerProfiles.js";
import { postJson } from "../providerHttp.js";
import { getDefaultModel } from "../../providerPresets.js";

const WAN_PROFILE = getProviderProfile("wan")!;
// Wan 的能力按 model 动态变化：标准模型 vs pro 模型。数据集中在配置表，
// 这里取出 pro 变体供 getSizeConstraints/getResolutionOptions/generate 共用。
const WAN_PRO_VARIANT = WAN_PROFILE.variants![0];

/**
 * 通义万相 Wan 2.7 adapter。
 *
 * Wan 2.7 同步调用走 DashScope multimodal-generation：
 *   POST /api/v1/services/aigc/multimodal-generation/generation
 *
 * 本 adapter 选用 wan2.7-image 作为默认模型。若用户在 login 时选择
 * wan2.7-image-pro，/auth/status 会回流 pro 的文生图 4K 能力；
 * 但图像编辑仍按官方限制最高 2K，超过 2K 时直接报错提醒。
 *
 * 能力数据（静态 + pro 变体）见 providerProfiles.ts 的 wan 条目。
 */

/** Wan 标准模型 size 约束（从配置表读，normalizeWanSize 默认参数和 generate 共用）。 */
const STANDARD_SIZE_CONSTRAINTS: SizeConstraints = WAN_PROFILE.sizeConstraints;

const DEFAULT_MODEL = getDefaultModel("wan")!;
const EDIT_CONSTRAINTS = WAN_PROFILE.editConstraints;
const MAX_EDIT_IMAGES = EDIT_CONSTRAINTS?.maxImages;

export const wanAdapter: ProviderAdapter = {
  id: "wan",
  capability: WAN_PROFILE.capability,
  sizeConstraints: WAN_PROFILE.sizeConstraints,
  resolutionOptions: WAN_PROFILE.resolutionOptions,

  getSizeConstraints(config: ProviderConfig) {
    return isWanProModel(config.model) ? WAN_PRO_VARIANT.sizeConstraints : WAN_PROFILE.sizeConstraints;
  },

  getResolutionOptions(config: ProviderConfig) {
    return isWanProModel(config.model)
      ? WAN_PRO_VARIANT.resolutionOptions
      : WAN_PROFILE.resolutionOptions;
  },

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_MODEL, providerId: "wan" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_MODEL;
    const size = normalizeWanSize(
      request.size,
      isWanProModel(model) ? WAN_PRO_VARIANT.sizeConstraints : STANDARD_SIZE_CONSTRAINTS,
    );

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
        parameters: {
          size,
          n: 1,
          watermark: false,
          thinking_mode: true,
        },
      },
    );

    const imageUrl = await parseDashScopeResponse(
      response,
      "Wan 响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl);
    return { b64Json, mimeType };
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Wan 图像编辑需要至少一张参考图。");
    }
    if (MAX_EDIT_IMAGES !== undefined && request.images.length > MAX_EDIT_IMAGES) {
      throw new Error(`Wan 图像编辑最多支持 ${MAX_EDIT_IMAGES} 张参考图。`);
    }
    const unsupportedResolution = getUnsupportedWanEditResolution(request);
    if (unsupportedResolution) {
      const maxResolution = getMaxEditResolutionLabel();
      throw new Error(
        `Wan 图像编辑不支持 ${unsupportedResolution} 分辨率，请切换到 ${maxResolution} 或更低后重试。`,
      );
    }

    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_MODEL;
    const size = normalizeWanSize(request.size, STANDARD_SIZE_CONSTRAINTS);

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
        parameters: {
          size,
          n: 1,
          watermark: false,
        },
      },
    );

    const imageUrl = await parseDashScopeResponse(
      response,
      "Wan 编辑响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl);
    return { b64Json, mimeType };
  },
};

/**
 * 把 OpenAI 形状的 size 规整成 DashScope Wan 接口使用的 `宽*高`。
 */
export function normalizeWanSize(
  size: string,
  constraints: SizeConstraints = STANDARD_SIZE_CONSTRAINTS,
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
      console.warn(`[wan] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
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

  const normalizeBoundsAndRatio = () => {
    w = clamp(w, constraints.min, constraints.max, constraints);
    h = clamp(h, constraints.min, constraints.max, constraints);
    if (constraints.maxAspectRatio) {
      if (w / h > constraints.maxAspectRatio) {
        w = alignToStep(h * constraints.maxAspectRatio, constraints);
      } else if (h / w > constraints.maxAspectRatio) {
        h = alignToStep(w * constraints.maxAspectRatio, constraints);
      }
      w = clamp(w, constraints.min, constraints.max, constraints);
      h = clamp(h, constraints.min, constraints.max, constraints);
    }
  };

  normalizeBoundsAndRatio();

  const scalePixels = (targetPixels: number) => {
    const ratio = Math.sqrt(targetPixels / (w * h));
    w = alignToStep(w * ratio, constraints);
    h = alignToStep(h * ratio, constraints);
    normalizeBoundsAndRatio();
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
    normalizeBoundsAndRatio();
  }

  return `${w}*${h}`;
}

function toDashScopeSize(size: string): string {
  return size.replace(/[x×]/i, "*");
}

function isWanProModel(model?: string): boolean {
  return model === WAN_PRO_VARIANT.modelId;
}

function getUnsupportedWanEditResolution(
  request: OpenAIImageEditRequest,
): string | null {
  const editOptions = EDIT_CONSTRAINTS?.resolutionOptions;
  if (!editOptions) return null;

  const normalizedResolution = request.resolution?.trim().toLowerCase();
  if (normalizedResolution) {
    const knownOption = getKnownWanResolutionOptions().find(
      (option) => option.value.toLowerCase() === normalizedResolution,
    );
    if (
      knownOption &&
      !editOptions.some(
        (option) => option.value.toLowerCase() === normalizedResolution,
      )
    ) {
      return knownOption.label;
    }
  }

  return isClearlyBeyondEditSize(request.size)
    ? getLargestWanResolutionLabel()
    : null;
}

function isClearlyBeyondEditSize(size: string): boolean {
  const trimmed = size.trim().toLowerCase();
  const match = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(trimmed);
  if (!match) return false;
  const maxEditPixels = Math.max(
    ...(EDIT_CONSTRAINTS?.resolutionOptions?.map((option) => option.targetPixels) ?? [
      STANDARD_SIZE_CONSTRAINTS.maxPixels,
    ]),
  );
  // Web 端比例计算和上游返回尺寸可能产生几个像素的取整误差。
  // 只有明显超过编辑档位上限时才拒绝，其余具体尺寸交给 normalizeWanSize 规整。
  return Number(match[1]) * Number(match[2]) > maxEditPixels * 1.05;
}

function getKnownWanResolutionOptions() {
  const options = [...WAN_PROFILE.resolutionOptions, ...WAN_PRO_VARIANT.resolutionOptions];
  return options.filter(
    (option, index) => options.findIndex((candidate) => candidate.value === option.value) === index,
  );
}

function getLargestWanResolutionLabel(): string {
  return getKnownWanResolutionOptions().at(-1)?.label ?? "更低";
}

function getMaxEditResolutionLabel(): string {
  return EDIT_CONSTRAINTS?.resolutionOptions?.at(-1)?.label ?? "更低";
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
