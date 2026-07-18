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
 * Qwen-Image（阿里通义千问团队）adapter。
 *
 * Qwen-Image 走 DashScope multimodal-generation 同步接口：
 *   POST /api/v1/services/aigc/multimodal-generation/generation
 *
 * 返回结果是 message.content[] 里的图片 URL。Companion 立即下载并转成
 * OpenAI Images API 兼容的 b64_json，Web 侧无需理解 DashScope 形状。
 */

/**
 * Qwen-Image 2.0 系列官方尺寸规则：
 * - size 格式为 `宽*高`
 * - 总像素需在 512*512 至 2048*2048 之间
 * - 默认分辨率为 2048*2048
 *
 * SizeConstraints 还需要单边 min/max 供 Web 通用校验逻辑使用。官方没有给
 * qwen-image-2.0 系列单边硬上限；这里的 max=8192 是在 min=512 时由
 * maxPixels / min 推导出的 UI 边界，可覆盖较宽的合法尺寸。
 */
const SIZE_CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 512,
  max: 8192,
  maxPixels: 2048 * 2048,
  minPixels: 512 * 512,
  maxAspectRatio: null,
  defaultSize: "2048x2048",
};

const CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: false,
  backgrounds: ["auto"],
  outputFormats: ["png"],
};

const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
];

const DEFAULT_QWEN_MODEL = "qwen-image-2.0-pro";
const MAX_EDIT_IMAGES = 3;

export const qwenAdapter: ProviderAdapter = {
  id: "qwen",
  capability: CAPABILITY,
  sizeConstraints: SIZE_CONSTRAINTS,
  resolutionOptions: RESOLUTION_OPTIONS,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_QWEN_MODEL, providerId: "qwen" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_QWEN_MODEL;
    const size = normalizeQwenSize(request.size, SIZE_CONSTRAINTS);

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
          parameters: { size },
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const imageUrl = await parseDashScopeResponse(
      response,
      "Qwen-Image 响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl);
    return { b64Json, mimeType };
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Qwen-Image 图像编辑需要至少一张参考图。");
    }
    if (request.images.length > MAX_EDIT_IMAGES) {
      throw new Error(`Qwen-Image 图像编辑最多支持 ${MAX_EDIT_IMAGES} 张参考图。`);
    }

    const apiUrl = buildDashScopeGenerationUrl(config.apiBaseUrl);
    const model = config.model ?? DEFAULT_QWEN_MODEL;
    const size = normalizeQwenSize(request.size, SIZE_CONSTRAINTS);

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
          parameters: { size },
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const imageUrl = await parseDashScopeResponse(
      response,
      "Qwen-Image 编辑响应中没有 output.choices[0].message.content[].image",
    );
    const { b64Json, mimeType } = await urlToB64(imageUrl);
    return { b64Json, mimeType };
  },
};

const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

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
