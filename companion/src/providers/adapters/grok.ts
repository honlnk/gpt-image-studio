/**
 * Grok Imagine（xAI）adapter。
 *
 * 走 OpenAI 兼容的 /v1/images/{generations,edits} 端点、Bearer 鉴权，响应是标准
 * data[0].b64_json 形状，但在「size」维度与 OpenAI 有本质差异：Grok 不认 WxH 像素，
 * 而是 aspect_ratio（比例枚举）+ resolution（1k/2k 档位枚举）两个独立字段。
 *
 *   文生图：POST {base}/v1/images/generations（aspect_ratio + resolution 枚举翻译）
 *   图片编辑：POST {base}/v1/images/edits（JSON body + image_url 形状，单图 image / 多图 images 互斥）
 *   响应：data[0].b64_json
 *
 * Grok edits 不支持 mask 局部重绘（capability.mask=false），带 mask 的请求由 route 层返回 400。
 *
 * 协议来源：xAI 官方 OpenAPI spec 的 GenerateImageRequest / EditImageRequest /
 * ImageAspectRatio / ImageResolution schema。
 *
 * 能力数据（capability/sizeConstraints/resolutionOptions）统一在
 * providerProfiles.ts + profiles/grok.json，本文件只放 size 翻译与 body 构造逻辑。
 *
 * 工厂扩展点用法：
 *   - normalizeBaseUrl：补全 /v1/images 路径段
 *   - buildGenerateBody：完全自定义 generate body（aspect_ratio + resolution 而非 size）
 *   - buildEditRequest：完全自定义 edit 请求（JSON body + image_url 形状，走 /edits 但非 multipart）
 */

import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  ProviderConfig,
} from "../types.js";
import { getProviderProfile } from "../providerProfiles.js";
import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";

const GROK_PROFILE = getProviderProfile("grok")!;

/**
 * Grok 官方支持的 aspect_ratio / resolution 枚举见 profiles/grok.json 的
 * adapterConfig（supportedAspectRatios + supportedResolutions），本文件只放翻译算法。
 */

export const grokAdapter = createOpenAICompatibleAdapter({
  id: "grok",
  fieldMode: "strict",
  requiredFields: { response_format: "b64_json" },
  responseShape: "data_b64",
  editMode: "none",
  // grok 不用 size 字段，generate/edit body 由 buildGenerateBody / buildEditRequest 接管，
  // normalizeSize 仅作为工厂配置的必填项占位（不会被调用到）。
  normalizeSize: (size) => size,
  normalizeBaseUrl: normalizeGrokBaseUrl,
  buildGenerateBody: buildGrokGenerateBody,
  buildEditRequest: buildGrokEditRequest,
});

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
 * 构建 Grok 编辑请求（JSON body + image_url 形状，走 /edits 端点）。
 * - 单图 → image 字段；多图 → images 字段（互斥）。
 * - 图片以 { type:"image_url", url:"data:<mime>;base64,<b64>" } 形状传递。
 */
export function buildGrokEditRequest(
  request: OpenAIImageEditRequest,
  providerConfig: ProviderConfig,
  model: string,
): { apiUrl: string; body: Record<string, unknown> } {
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

  const apiUrl = `${normalizeGrokBaseUrl(providerConfig.apiBaseUrl)}/edits`;
  return { apiUrl, body };
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
