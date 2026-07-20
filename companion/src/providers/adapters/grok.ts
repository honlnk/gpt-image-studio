/**
 * Grok Imagine（xAI）adapter。
 *
 * 走 OpenAI 兼容的 /v1/images/{generations,edits} 端点、Bearer 鉴权，响应是标准
 * data[0].b64_json 形状，但在「size」维度与 OpenAI 有本质差异：Grok 不认 WxH 像素，
 * 而是 aspect_ratio（比例枚举）+ resolution（1k/2k 档位枚举）两个独立字段。
 *
 *   文生图：POST {base}/v1/images/generations（aspect_ratio + resolution 枚举翻译）
 *   图片编辑：POST {base}/v1/images/edits（image_url 形状，单图 image / 多图 images 互斥）
 *   响应：data[0].b64_json
 *
 * Grok edits 不支持 mask 局部重绘（capability.mask=false），带 mask 的请求由 route 层返回 400。
 *
 * 协议来源：xAI 官方 OpenAPI spec 的 GenerateImageRequest / EditImageRequest /
 * ImageAspectRatio / ImageResolution schema。
 *
 * 能力数据（capability/sizeConstraints/resolutionOptions）统一在
 * providerProfiles.ts + profiles/grok.json，本文件只放 size 翻译逻辑。
 */

import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCallOptions,
  ProviderConfig,
} from "../types.js";
import { getProviderProfile } from "../providerProfiles.js";
import { parseImagesResponse, postJson } from "../providerHttp.js";
import { getDefaultModel } from "../../providerPresets.js";

const GROK_PROFILE = getProviderProfile("grok")!;

/**
 * Grok 官方支持的 aspect_ratio / resolution 枚举见 profiles/grok.json 的
 * adapterConfig（supportedAspectRatios + supportedResolutions），本文件只放翻译算法。
 */

export const grokAdapter: ProviderAdapter = {
  id: "grok",
  capability: GROK_PROFILE.capability,
  sizeConstraints: GROK_PROFILE.sizeConstraints,
  resolutionOptions: GROK_PROFILE.resolutionOptions,

  describe(config: ProviderConfig) {
    return { label: config.model ?? getDefaultModel("grok")!, providerId: "grok" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${normalizeGrokBaseUrl(config.apiBaseUrl)}/generations`;
    const model = config.model ?? getDefaultModel("grok")!;
    const body = buildGrokGenerateBody(request, model);

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      body,
      options,
    );

    return parseImagesResponse(response, "Grok");
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Grok 图片编辑需要至少一张参考图。");
    }

    const apiUrl = `${normalizeGrokBaseUrl(config.apiBaseUrl)}/edits`;
    const model = config.model ?? getDefaultModel("grok")!;
    const body = buildGrokEditBody(request, model);

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      body,
      options,
    );

    return parseImagesResponse(response, "Grok");
  },
};

/**
 * 构建 Grok 文生图请求体。
 * - response_format 固定 b64_json。
 * - aspect_ratio：当 request.size 是支持的比例枚举时带上，否则不传（让 Grok 自选）。
 * - resolution：从 request.resolution 读，仅当是支持的值时带上。
 */
export function buildGrokGenerateBody(
  request: OpenAIImageRequest,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    response_format: "b64_json",
  };

  const aspectRatio = readGrokAspectRatio(request.size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const resolution = readGrokResolution(request.resolution);
  if (resolution) body.resolution = resolution;

  return body;
}

/**
 * 构建 Grok 编辑请求体。
 * - 单图 → image 字段；多图 → images 字段（互斥）。
 * - 图片以 { type:"image_url", url:"data:<mime>;base64,<b64>" } 形状传递。
 */
export function buildGrokEditBody(
  request: OpenAIImageEditRequest,
  model: string,
): Record<string, unknown> {
  const imageUrls = request.images.map((img) => ({
    type: "image_url" as const,
    url: `data:${img.mimeType};base64,${img.blob.toString("base64")}`,
  }));

  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    response_format: "b64_json",
  };

  if (imageUrls.length === 1) {
    body.image = imageUrls[0];
  } else {
    body.images = imageUrls;
  }

  const aspectRatio = readGrokAspectRatio(request.size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const resolution = readGrokResolution(request.resolution);
  if (resolution) body.resolution = resolution;

  return body;
}

function readGrokAspectRatio(size: string): string | null {
  const trimmed = size.trim();
  if (trimmed === "auto" || trimmed === "") return null;
  const supported = GROK_PROFILE.adapterConfig?.supportedAspectRatios;
  if (supported && trimmed.includes(":") && supported.includes(trimmed)) {
    return trimmed;
  }
  return null;
}

function readGrokResolution(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  const supported = GROK_PROFILE.adapterConfig?.supportedResolutions;
  if (supported && supported.includes(trimmed)) return trimmed;
  return null;
}

/**
 * 规整 Grok base url，确保以 /v1/images 结尾。
 *   - "https://api.x.ai"           → "https://api.x.ai/v1/images"
 *   - "https://api.x.ai/v1"        → "https://api.x.ai/v1/images"
 *   - "https://api.x.ai/v1/images" → 原样（去掉尾部斜杠）
 */
export function normalizeGrokBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  if (/\/v1\/images$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/images`;
  return `${trimmed}/v1/images`;
}
