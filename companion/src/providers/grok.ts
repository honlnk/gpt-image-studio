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
import { sniffMimeTypeFromBase64 } from "./imageSignature.js";

/**
 * Grok Imagine（xAI）adapter。
 *
 * xAI 的图片接口走 OpenAI 兼容的 /v1/images/{generations,edits} 端点、Bearer 鉴权，
 * 但在「尺寸」维度与 OpenAI 有本质差异：Grok 不认 WxH 像素，而是
 * `aspect_ratio`（比例枚举）+ `resolution`（1k/2k 档位枚举）两个独立字段。
 *
 * 与 OpenAI adapter 的差异（adapter 内部处理）：
 *   1. size 不透传：把 web 发来的比例格式（如 "16:9"）转成 aspect_ratio 字段，
 *      WxH / auto 形式则不传 aspect_ratio（让 Grok 自选）。
 *   2. resolution 从 request.resolution 读（web 发的 "1k"/"2k" 档位），转成 Grok 的 resolution 字段。
 *      注意：request.outputFormat 是图片格式（png/jpeg），不是分辨率。
 *   3. 编辑走 /v1/images/edits，单图用 image 字段、多图用 images 字段（互斥），
 *      图片以 { type:"image_url", url:"data:..." } 形状传递（OpenAI chat 兼容形状）。
 *   4. 固定 response_format=b64_json，避免拿到有时效的 url 再二次下载。
 *
 * Grok edits 不支持 mask 局部重绘（capability.mask=false），带 mask 的请求由 route 层返回 400。
 *
 * 协议来源：xAI 官方 OpenAPI spec（https://docs.x.ai/openapi.json）的
 * GenerateImageRequest / EditImageRequest / ImageAspectRatio / ImageResolution schema。
 */

/** Grok 的尺寸边界（单边像素，仅作 web UI 校验用）。实际尺寸由 aspect_ratio + resolution 决定。 */
const SIZE_CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 512,
  max: 4096,
  maxPixels: 4096 * 4096,
  minPixels: 0,
  maxAspectRatio: null, // Grok 用 aspect_ratio 枚举约束，不在此数值约束
  defaultSize: "1024x1024",
};

/**
 * Grok 能力声明。
 * - edit=true：原生支持 /v1/images/edits（图生图、多图融合）。
 * - mask=false：edits 不支持 mask 局部重绘。
 * - backgrounds 去 transparent：Grok 不支持透明背景。
 */
const CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: false,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "jpeg", "webp"],
};

/** Grok 支持的分辨率档位（官方 ImageResolution 枚举：仅 1k / 2k）。 */
const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
];

/**
 * Grok 官方支持的 aspect_ratio 枚举（来自 OpenAPI ImageAspectRatio schema）。
 * web 发来的比例若不在此列则不传 aspect_ratio，让 Grok 自动选择。
 */
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
]);

/** Grok 官方支持的 resolution 枚举（小写）。 */
const SUPPORTED_RESOLUTIONS = new Set(["1k", "2k"]);

/** Grok 默认 base url（xAI 官方 API）。login 时可被覆盖。 */
const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1/images";
/** Grok 默认 model。login 时可填自定义（如 grok-imagine-image-quality）。 */
const DEFAULT_GROK_MODEL = "grok-imagine-image";

export const grokAdapter: ProviderAdapter = {
  id: "grok",
  capability: CAPABILITY,
  sizeConstraints: SIZE_CONSTRAINTS,
  resolutionOptions: RESOLUTION_OPTIONS,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_GROK_MODEL, providerId: "grok" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${normalizeGrokBaseUrl(config.apiBaseUrl)}/generations`;
    const model = config.model ?? DEFAULT_GROK_MODEL;
    const body = buildGrokGenerateBody(request, model);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    return parseGrokResponse(response);
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    if (request.images.length === 0) {
      throw new Error("Grok 图片编辑需要至少一张参考图。");
    }

    const apiUrl = `${normalizeGrokBaseUrl(config.apiBaseUrl)}/edits`;
    const model = config.model ?? DEFAULT_GROK_MODEL;
    const body = buildGrokEditBody(request, model);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    return parseGrokResponse(response);
  },
};

const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

/**
 * 构建 Grok 文生图请求体。
 * - model/prompt 必带。
 * - response_format 固定 b64_json。
 * - aspect_ratio：当 request.size 是支持的比例枚举时带上，否则不传（让 Grok 自选）。
 * - resolution：从 request.resolution 读（web 的档位选择），仅当是支持的值时带上。
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

  const aspectRatio = readAspectRatio(request.size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const resolution = readResolution(request.resolution);
  if (resolution) body.resolution = resolution;

  return body;
}

/**
 * 构建 Grok 编辑请求体。
 * - 单图 → image 字段（一个 image_url 对象）。
 * - 多图 → images 字段（image_url 对象数组）。image 与 images 互斥。
 * - 图片以 { type:"image_url", url:"data:<mime>;base64,<b64>" } 形状传递。
 * - aspect_ratio / resolution 同文生图（多图融合时可指定输出比例）。
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

  // image 与 images 互斥：单图用 image，多图用 images（与 xAI OpenAPI 一致）
  if (imageUrls.length === 1) {
    body.image = imageUrls[0];
  } else {
    body.images = imageUrls;
  }

  const aspectRatio = readAspectRatio(request.size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const resolution = readResolution(request.resolution);
  if (resolution) body.resolution = resolution;

  return body;
}

/**
 * 从 web 发来的 size 字段读取 aspect_ratio。
 * - 比例格式（"16:9"）且在 Grok 支持枚举内 → 返回该值。
 * - WxH / auto / 不支持的值 → 返回 null（不传 aspect_ratio，让 Grok 自动选择）。
 */
function readAspectRatio(size: string): string | null {
  const trimmed = size.trim();
  if (trimmed === "auto" || trimmed === "") return null;
  // 比例格式（含冒号）且在支持列表里
  if (trimmed.includes(":") && SUPPORTED_ASPECT_RATIOS.has(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * 从 request.resolution 读分辨率档位。
 */
function readResolution(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (SUPPORTED_RESOLUTIONS.has(trimmed)) return trimmed;
  return null;
}

/**
 * 规整 Grok base url，确保以 /v1/images 结尾。
 * 处理用户可能填的几种形式：
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

/**
 * 解析 Grok 响应。200 取 data[0].b64_json，非 2xx 抛带上游 error.message 的错。
 * Grok 已请求 response_format=b64_json，data[0].b64_json 必存在（除非上游异常）。
 */
async function parseGrokResponse(response: Response): Promise<OpenAIImageResult> {
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = extractErrorMessage(payload) ?? `Grok 请求失败：HTTP ${response.status}`;
    throw new Error(detail);
  }

  const item = payload?.data?.[0];
  const b64Json = item?.b64_json;
  if (!b64Json) {
    throw new Error(extractErrorMessage(payload) ?? "Grok 响应中没有 data[0].b64_json。");
  }
  return {
    b64Json,
    revisedPrompt: item?.revised_prompt,
    // Grok 响应不带 MIME，对 base64 做签名嗅探得到真实格式。
    mimeType: sniffMimeTypeFromBase64(b64Json) ?? undefined,
  };
}

function safeJsonParse(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: Record<string, any> | null): string | null {
  if (!payload) return null;
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  if (typeof payload.message === "string") return payload.message;
  return null;
}
