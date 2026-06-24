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

/**
 * 上游连接被主动断开（fetch 抛异常）时的统一文案。
 * 与 web 侧 imagesApi.ts 的「服务器主动断开了连接」文案语义对齐，
 * 保留原文案以维持现状体验。
 */
const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

/**
 * OpenAI Images API 的尺寸硬规则（gpt-image-2 等）。
 * 这组数字与 web 侧 imagesApi.ts getCustomSizeError 完全一致——
 * 阶段一后 web 改读 companion 上报的本字段，语义零变化。
 */
const OPENAI_SIZE_CONSTRAINTS: SizeConstraints = {
  step: 16,
  min: 16,
  max: 3840,
  maxPixels: 8294400,
  minPixels: 655360,
  maxAspectRatio: 3,
  defaultSize: "1024x1024",
};

/**
 * OpenAI（gpt-image-2）能力。
 * backgrounds 不含 transparent——gpt-image-2 不支持透明背景，web 现状已禁用该选项，
 * 这里保持一致（capability 驱动 UI 后 transparent 仍被过滤掉）。
 * 若未来接入的 OpenAI 兼容中转后端实际支持 transparent，再放开。
 */
const OPENAI_CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: true,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "webp", "jpeg"],
};

/**
 * OpenAI（gpt-image-2）支持的分辨率档位。
 * 与 web 原本写死的 SIZE_RESOLUTION_OPTIONS 一致——OpenAI 的真实档位。
 * 这里的值就是 OpenAI 的真实能力，不是「凑成和现状一致」。
 */
const OPENAI_RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
  { value: "4k", label: "4K", targetPixels: 3840 * 2160 },
];

/**
 * OpenAI adapter：现有透传逻辑（原 routes/images.ts）的整体搬迁。
 *
 * 入参是 OpenAI 形状，出参是 OpenAI 形状——对 OpenAI 这种本就兼容 OpenAI
 * 形状的 provider，翻译层实质是「原样转发 + 原样解析」。
 *
 * 与原 routes/images.ts 的行为差异说明：
 * - 原实现是把上游 status + text 原样回发给 web，由 web 自己解析 b64_json / error.message。
 * - adapter 层把「解析上游响应」这一步从 route 收到了 adapter 内部，
 *   这样 route 层对所有 provider 行为统一（都拿 { b64Json } 包成 data[0]）。
 *   解析逻辑本身（200 取 data[0].b64_json，非 200 抛带上游 message 的错）与
 *   web 侧 parseImageResponse 完全一致，对 OpenAI 用户语义零变化。
 */
export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  capability: OPENAI_CAPABILITY,
  sizeConstraints: OPENAI_SIZE_CONSTRAINTS,
  resolutionOptions: OPENAI_RESOLUTION_OPTIONS,

  describe(config: ProviderConfig) {
    return { label: config.model ?? "gpt-image-2", providerId: "openai" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    // 透传：model/prompt + 已知字段 + web 发出的所有其余字段（quality/stream/...）。
    // 与原 routes/images.ts 的 JSON.stringify(body) 行为等价，不丢字段。
    const body = JSON.stringify({
      ...request.extra,
      model: request.model,
      prompt: request.prompt,
      size: request.size,
      background: request.background,
      output_format: request.outputFormat,
    });

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    return parseImagesResponse(response);
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/edits`;
    const form = buildEditMultipart(request);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${form.boundary}`,
        },
        body: new Uint8Array(form.body),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    return parseImagesResponse(response);
  },
};

/**
 * 解析 OpenAI Images API 的响应，统一输出 { b64Json }。
 * 与 web 侧 parseImageResponse / extractImageResult 行为一致：
 * 200 取 data[0].b64_json，非 2xx 抛带上游 error.message 的错。
 */
async function parseImagesResponse(
  response: Response,
): Promise<OpenAIImageResult> {
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = extractErrorMessage(payload);
    throw new Error(detail ?? `请求失败：HTTP ${response.status}`);
  }

  const item = payload?.data?.[0];
  const b64Json = item?.b64_json;
  if (!b64Json) {
    throw new Error("响应中没有 data[0].b64_json。");
  }
  return {
    b64Json,
    revisedPrompt: item?.revised_prompt,
  };
}

function safeJsonParse(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function extractErrorMessage(
  payload: Record<string, any> | null,
): string | null {
  if (!payload) return null;
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  if (typeof payload.message === "string") return payload.message;
  return null;
}

/**
 * 把 OpenAI 形状的 edit 请求重新组装成 multipart/form-data。
 *
 * 原 routes/images.ts 是把 web 发来的原始 multipart Buffer 原样转发，
 * 但 adapter 接收的是结构化字段（route 层已校验），所以这里重建 multipart。
 * 重建而非透传是为了让 adapter 形状统一——所有 provider 收到的都是结构化字段，
 * 非兼容 provider（如 GLM 全图编辑走 chat）不必关心 multipart 细节。
 *
 * 字段顺序：先 prompt/model 等文本字段，再 image[]，最后 mask——
 * 与 web 发出的字段顺序保持一致，便于排查。
 */
function buildEditMultipart(request: OpenAIImageEditRequest): {
  boundary: string;
  body: Buffer;
} {
  const boundary = `----companion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const crlf = "\r\n";
  const parts: Buffer[] = [];

  function addField(name: string, value: string) {
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`,
        "utf8",
      ),
    );
  }

  function addFile(
    name: string,
    image: { blob: Buffer; name: string; mimeType: string },
  ) {
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"; filename="${image.name}"${crlf}Content-Type: ${image.mimeType}${crlf}${crlf}`,
        "utf8",
      ),
    );
    parts.push(image.blob);
    parts.push(Buffer.from(crlf, "utf8"));
  }

  addField("model", request.model);
  addField("prompt", request.prompt);
  addField("size", request.size);
  addField("background", request.background);
  addField("output_format", request.outputFormat);

  // web 编辑请求里额外的文本字段（stream / partial_images 等）原样带上，
  // 与原 routes/images.ts 透传整个 multipart Buffer 行为等价。
  for (const [key, value] of Object.entries(request.editExtra)) {
    addField(key, value);
  }

  for (const image of request.images) {
    addFile("image[]", image);
  }
  if (request.mask) {
    addFile("mask", request.mask);
  }

  parts.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));
  return { boundary, body: Buffer.concat(parts) };
}
