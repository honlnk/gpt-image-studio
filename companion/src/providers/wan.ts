import {
  buildDashScopeGenerationUrl,
  dataUrlFromImage,
  parseDashScopeResponse,
} from "./dashscope.js";
import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCapability,
  ProviderConfig,
  ResolutionOption,
  SizeConstraints,
} from "./types.js";
import { urlToB64 } from "./urlToB64.js";

/**
 * 通义万相 Wan 2.7 adapter。
 *
 * Wan 2.7 同步调用走 DashScope multimodal-generation：
 *   POST /api/v1/services/aigc/multimodal-generation/generation
 *
 * 本 adapter 选用 wan2.7-image 作为默认模型。若用户在 login 时选择
 * wan2.7-image-pro，/auth/status 会回流 pro 的文生图 4K 能力；
 * 但图像编辑仍按官方限制最高 2K，超过 2K 时直接报错提醒。
 */

/**
 * Wan 2.7 官方尺寸规则（wan2.7-image）：
 * - size 支持 1K/2K 或 `宽*高`
 * - 所有场景总像素需在 768*768 至 2048*2048 之间
 * - 宽高比范围为 1:8 至 8:1
 * - 默认分辨率为 2K（2048*2048）
 *
 * SizeConstraints 需要单边 min/max 供 Web 通用校验逻辑使用。官方规则是
 * 总像素 + 宽高比，这里的单边 min/max 是由 768*768 / 2048*2048 推导出的
 * 保守 UI 边界。
 */
const STANDARD_SIZE_CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 768,
  max: Math.floor((2048 * 2048) / 768),
  maxPixels: 2048 * 2048,
  minPixels: 768 * 768,
  maxAspectRatio: 8,
  defaultSize: "2048x2048",
};

const PRO_TEXT_SIZE_CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 768,
  max: Math.floor((4096 * 4096) / 768),
  maxPixels: 4096 * 4096,
  minPixels: 768 * 768,
  maxAspectRatio: 8,
  defaultSize: "2048x2048",
};

const CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: false,
  backgrounds: ["auto"],
  outputFormats: ["png"],
};

const STANDARD_RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
];

const PRO_TEXT_RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  ...STANDARD_RESOLUTION_OPTIONS,
  { value: "4k", label: "4K", targetPixels: 4096 * 2304 },
];

const DEFAULT_WAN_MODEL = "wan2.7-image";
const PRO_WAN_MODEL = "wan2.7-image-pro";
const MAX_EDIT_IMAGES = 9;

export const wanAdapter: ProviderAdapter = {
  id: "wan",
  capability: CAPABILITY,
  sizeConstraints: STANDARD_SIZE_CONSTRAINTS,
  resolutionOptions: STANDARD_RESOLUTION_OPTIONS,

  getSizeConstraints(config: ProviderConfig) {
    return isWanProModel(config.model) ? PRO_TEXT_SIZE_CONSTRAINTS : STANDARD_SIZE_CONSTRAINTS;
  },

  getResolutionOptions(config: ProviderConfig) {
    return isWanProModel(config.model)
      ? PRO_TEXT_RESOLUTION_OPTIONS
      : STANDARD_RESOLUTION_OPTIONS;
  },

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_WAN_MODEL, providerId: "wan" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_WAN_MODEL;
    const size = normalizeWanSize(
      request.size,
      isWanProModel(model) ? PRO_TEXT_SIZE_CONSTRAINTS : STANDARD_SIZE_CONSTRAINTS,
    );

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const imageUrl = await parseDashScopeResponse(
      response,
      "Wan 响应中没有 output.choices[0].message.content[].image",
    );
    return { b64Json: await urlToB64(imageUrl) };
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Wan 图像编辑需要至少一张参考图。");
    }
    if (request.images.length > MAX_EDIT_IMAGES) {
      throw new Error(`Wan 图像编辑最多支持 ${MAX_EDIT_IMAGES} 张参考图。`);
    }
    if (isExplicitWanEdit4K(request)) {
      throw new Error("Wan 图像编辑不支持 4K 分辨率，请切换到 2K 或更低后重试。");
    }

    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_WAN_MODEL;
    const size = normalizeWanSize(request.size, STANDARD_SIZE_CONSTRAINTS);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const imageUrl = await parseDashScopeResponse(
      response,
      "Wan 编辑响应中没有 output.choices[0].message.content[].image",
    );
    return { b64Json: await urlToB64(imageUrl) };
  },
};

const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

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
  return model === PRO_WAN_MODEL;
}

function isExplicitWanEdit4K(request: OpenAIImageEditRequest): boolean {
  if (request.editExtra.companion_resolution === "4k") return true;
  return isClearly4KSize(request.size);
}

function isClearly4KSize(size: string): boolean {
  const trimmed = size.trim().toLowerCase();
  if (trimmed === "4k") return true;
  const match = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(trimmed);
  if (!match) return false;
  // Web 端比例计算和上游返回尺寸可能产生几个像素的 2K 取整误差。
  // 只有明显超过 2K 时才视为 4K 意图；其余具体尺寸交给 normalizeWanSize 规整。
  return Number(match[1]) * Number(match[2]) > STANDARD_SIZE_CONSTRAINTS.maxPixels * 1.05;
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
