import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderConfig,
} from "../types.js";
import { getProviderProfile } from "../providerProfiles.js";
import {
  extractErrorMessage,
  postJson,
  safeJsonParse,
} from "../providerHttp.js";
import { getDefaultModel } from "../../providerPresets.js";

const GEMINI_PROFILE = getProviderProfile("gemini")!;
const DEFAULT_MODEL = getDefaultModel("gemini")!;

/**
 * Gemini Image（Google）adapter。
 *
 * Gemini 的图片生成走 generateContent 端点（文生图与编辑共用同一端点），
 * 与 OpenAI 形状差异极大，是典型的「翻译型」adapter：
 *
 *   OpenAI 形状                   → Gemini 形状
 *   ─────────────────────────────    ──────────────────────────────────
 *   POST /images/generations      → POST /v1beta/models/{model}:generateContent
 *   Authorization: Bearer         → x-goog-api-key header
 *   { model, prompt, size }       → { contents:[{parts:[{text}]}], generationConfig }
 *   data:[{b64_json}]             → candidates[].content.parts[].inlineData.data
 *
 * 尺寸参数（关键差异）：
 *   Gemini 用 generationConfig.responseFormat.image 里的 aspectRatio + imageSize 两个独立字段，
 *   不是 WxH 像素。responseFormat.image 用的是 **camelCase**（官方 REST 文档确认），
 *   与 Gemini 其他接口常见的 snake_case 不同——这里以官方文档为准。
 *
 * 编辑（图生图）：
 *   参考图作为 contents[0].parts 里的 inline_data part 追加（与 text part 并列），
 *   使用 **snake_case**（inline_data / mime_type）—— 与请求图片 part 的官方示例一致。
 *   编辑与文生图共用同一 :generateContent 端点，不区分。
 *
 * Gemini 不支持 mask 局部重绘（capability.mask=false），带 mask 的请求由 route 层返回 400。
 *
 * 能力数据（capability / sizeConstraints / resolutionOptions）见
 * providerProfiles.ts 的 gemini 条目。协议来源：Google 官方文档
 * ai.google.dev/gemini-api/docs/generate-content/image-generation。
 */

/**
 * Gemini 官方支持的 aspectRatio / imageSize 枚举见 profiles/gemini.json 的
 * adapterConfig（supportedAspectRatios + resolutionMap），本文件只放翻译算法。
 */

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  capability: GEMINI_PROFILE.capability,
  sizeConstraints: GEMINI_PROFILE.sizeConstraints,
  resolutionOptions: GEMINI_PROFILE.resolutionOptions,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_MODEL, providerId: "gemini" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const model = config.model ?? DEFAULT_MODEL;
    const apiUrl = buildGeminiGenerateContentUrl(config.apiBaseUrl, model);
    const body = buildGeminiRequestBody(
      request.prompt,
      request.size,
      request.resolution,
      /* images */ undefined,
    );

    const response = await postJson(
      apiUrl,
      { "x-goog-api-key": config.apiKey },
      body,
    );

    return parseGeminiResponse(response);
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Gemini 图片编辑需要至少一张参考图。");
    }

    const model = config.model ?? DEFAULT_MODEL;
    const apiUrl = buildGeminiGenerateContentUrl(config.apiBaseUrl, model);
    const body = buildGeminiRequestBody(
      request.prompt,
      request.size,
      request.resolution,
      request.images,
    );

    const response = await postJson(
      apiUrl,
      { "x-goog-api-key": config.apiKey },
      body,
    );

    return parseGeminiResponse(response);
  },
};

/**
 * 构建 Gemini generateContent 请求体。
 *
 * @param prompt   文本提示
 * @param size     web 发来的 size（比例格式如 "16:9"，或 WxH/auto）
 * @param resolution web 选择的分辨率档位
 * @param images   编辑时的参考图（文生图时为 undefined）
 *
 * 结构：
 *   {
 *     contents: [{ parts: [{text}, ...inline_data] }],
 *     generationConfig: {
 *       responseModalities: ["TEXT","IMAGE"],
 *       responseFormat: { image: { aspectRatio?, imageSize? } }
 *     }
 *   }
 *
 * 注意：responseFormat.image 用 camelCase（aspectRatio/imageSize），与官方 REST 文档一致。
 */
export function buildGeminiRequestBody(
  prompt: string,
  size: string,
  resolution: string | undefined,
  images?: { blob: Buffer; mimeType: string }[],
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ text: prompt }];

  // 编辑：参考图作为 inline_data part 追加（snake_case，与官方示例一致）
  if (images && images.length > 0) {
    for (const img of images) {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.blob.toString("base64"),
        },
      });
    }
  }

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  };

  const imageConfig: Record<string, string> = {};
  const aspectRatio = readAspectRatio(size);
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;

  const imageSize = readImageSize(resolution);
  if (imageSize) imageConfig.imageSize = imageSize;

  if (Object.keys(imageConfig).length > 0) {
    generationConfig.responseFormat = { image: imageConfig };
  }

  return { contents: [{ parts }], generationConfig };
}

/**
 * 从 web 发来的 size 字段读取 aspectRatio。
 * - 比例格式（"16:9"）且在 Gemini 支持枚举内 → 返回该值。
 * - WxH / auto / 不支持的值 → 返回 null（让 Gemini 用默认或匹配输入图）。
 * 枚举集来自 profiles/gemini.json 的 adapterConfig.supportedAspectRatios。
 */
function readAspectRatio(size: string): string | null {
  const trimmed = size.trim();
  if (trimmed === "auto" || trimmed === "") return null;
  const supported = GEMINI_PROFILE.adapterConfig?.supportedAspectRatios;
  if (supported && trimmed.includes(":") && supported.includes(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * 从 request.resolution 读档位，转成 Gemini 的 imageSize（大写）。
 * web 发 "2k" → Gemini 要 "2K"。映射表来自 adapterConfig.resolutionMap。
 */
function readImageSize(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return GEMINI_PROFILE.adapterConfig?.resolutionMap?.[trimmed] ?? null;
}

/**
 * 构建 generateContent URL：{base}/models/{model}:generateContent
 * base 规整到 /v1beta（或保留用户填的 /v1 / /v1beta）。
 */
export function buildGeminiGenerateContentUrl(apiBaseUrl: string, model: string): string {
  const base = normalizeGeminiBaseUrl(apiBaseUrl);
  return `${base}/models/${encodeURIComponent(model)}:generateContent`;
}

/**
 * 规整 Gemini base url，确保含版本段（/v1beta 或 /v1）。
 *   - "https://...googleapis.com"          → "https://...googleapis.com/v1beta"
 *   - "https://...googleapis.com/v1beta"    → 原样
 *   - "https://...googleapis.com/v1"        → 原样
 */
export function normalizeGeminiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  if (/\/v\d+(beta)?$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1beta`;
}

/**
 * 解析 Gemini generateContent 响应。
 *
 * 响应形状：candidates[].content.parts[].{inlineData|inline_data}.{data, mimeType|mime_type}
 * 注意：响应可能是 camelCase（inlineData/mimeType）或 snake_case（inline_data/mime_type），
 * 两种都要兼容（Google 不同 SDK/版本返回不一致，官方文档示例两种都出现过）。
 *
 * 取第一个含图片数据的 part 的 base64 data。
 */
async function parseGeminiResponse(response: Response): Promise<OpenAIImageResult> {
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = extractErrorMessage(payload) ?? `Gemini 请求失败：HTTP ${response.status}`;
    throw new Error(detail);
  }

  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error(
      extractErrorMessage(payload) ??
        "Gemini 响应中没有 candidates[].content.parts[].inlineData.data。",
    );
  }

  // 遍历所有 candidate 的所有 part，找第一个含图片 base64 数据的
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline = extractInlineData(part);
      if (inline) {
        return { b64Json: inline.data, mimeType: inline.mimeType };
      }
    }
  }

  throw new Error(
    extractErrorMessage(payload) ??
      "Gemini 响应中没有 candidates[].content.parts[].inlineData.data。",
  );
}

/**
 * 从一个 part 里提取图片 base64 数据及厂商声明的 MIME，兼容 camelCase 和 snake_case。
 * 返回 null 表示该 part 不是图片 part（可能是 text part）。
 * mimeType 可能为 undefined（厂商未声明时），由调用方决定是否嗅探。
 */
function extractInlineData(
  part: Record<string, any>,
): { data: string; mimeType?: string } | null {
  // camelCase: inlineData.{data, mimeType}
  const inlineDataCamel = part?.inlineData;
  if (inlineDataCamel && typeof inlineDataCamel.data === "string" && inlineDataCamel.data) {
    return { data: inlineDataCamel.data, mimeType: readOptionalString(inlineDataCamel.mimeType) };
  }
  // snake_case: inline_data.{data, mime_type}
  const inlineDataSnake = part?.inline_data;
  if (inlineDataSnake && typeof inlineDataSnake.data === "string" && inlineDataSnake.data) {
    return { data: inlineDataSnake.data, mimeType: readOptionalString(inlineDataSnake.mime_type) };
  }
  return null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
