import type { FastifyInstance } from "fastify";
import { getActiveCredential } from "../credentials.js";
import type { CompanionSecurityConfig } from "../securityConfig.js";
import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  ProviderConfig,
} from "../providers/types.js";
import { resolveAdapter } from "../providers/registry.js";
import { extractBoundary, parseMultipart } from "../providers/multipart.js";
import type { ParsedEditBody } from "../providers/multipart.js";
import {
  KNOWN_EDIT_FIELDS,
  KNOWN_GENERATE_FIELDS,
} from "../shared/knownFields.js";

type ImagesRoutesOptions = {
  security: CompanionSecurityConfig;
};

export async function imagesRoutes(app: FastifyInstance, opts: ImagesRoutesOptions) {
  app.post("/images/generations", async (req, reply) => {
    const creds = getActiveCredential();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先添加 provider 配置" });
    }

    if (!isJsonRequest(req.headers["content-type"])) {
      return reply.status(415).send({ error: "请求 Content-Type 必须是 application/json" });
    }

    const body = req.body as Record<string, unknown>;
    const validationError = validateGenerationBody(body);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const config = toProviderConfig(creds);
    const adapter = resolveAdapter(config);
    if (!adapter.capability.generate) {
      return reply.status(501).send({ error: "当前 provider 不支持文生图" });
    }

    const request = toGenerateRequest(body);
    logNormalizedImageRequest(app, {
      operation: "generate",
      provider: adapter.id,
      model: request.model,
      size: request.size,
      resolution: request.resolution,
      background: request.background,
      outputFormat: request.outputFormat,
    });
    let result;
    try {
      result = await adapter.generate(request, config);
    } catch (error) {
      return reply.status(502).send({ error: errorMessage(error) });
    }

    return reply.send({
      data: [{ b64_json: result.b64Json, revised_prompt: result.revisedPrompt, mime_type: result.mimeType }],
    });
  });

  app.addContentTypeParser("multipart/form-data", function (_req, payload, done) {
    const chunks: Buffer[] = [];
    payload.on("data", (chunk: Buffer) => chunks.push(chunk));
    payload.on("end", () => done(null, Buffer.concat(chunks)));
    payload.on("error", done);
  });

  app.post("/images/edits", { bodyLimit: opts.security.maxEditBodyBytes }, async (req, reply) => {
    const creds = getActiveCredential();
    if (!creds) {
      return reply.status(503).send({ error: "Companion 未配置凭据，请先添加 provider 配置" });
    }

    if (!isMultipartRequest(req.headers["content-type"])) {
      return reply.status(415).send({ error: "请求 Content-Type 必须是 multipart/form-data" });
    }

    const rawBody = req.body as Buffer;
    const boundary = extractBoundary(req.headers["content-type"]!);
    if (!boundary) {
      return reply.status(400).send({ error: "multipart 请求缺少 boundary" });
    }
    const parsed = parseMultipart(rawBody, boundary);
    if ("message" in parsed) {
      return reply.status(400).send({ error: parsed.message });
    }

    // 只对结构化解析结果做一次语义校验，确保校验对象与 Adapter 收到的数据完全一致。
    const validationError = validateEditMultipart(parsed, opts.security);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const config = toProviderConfig(creds);
    const adapter = resolveAdapter(config);
    if (!adapter.capability.edit || !adapter.edit) {
      return reply.status(501).send({ error: "当前 provider 不支持图片编辑" });
    }

    // mask 能力校验：带 mask 但 provider 不支持 → 明确报错
    if (parsed.mask && !adapter.capability.mask) {
      return reply.status(400).send({ error: "当前 provider 不支持遮罩局部编辑" });
    }

    const editRequest = toEditRequest(parsed);
    logNormalizedImageRequest(app, {
      operation: "edit",
      provider: adapter.id,
      model: editRequest.model,
      size: editRequest.size,
      resolution: editRequest.resolution,
      background: editRequest.background,
      outputFormat: editRequest.outputFormat,
    });
    let result;
    try {
      result = await adapter.edit(editRequest, config);
    } catch (error) {
      return reply.status(502).send({ error: errorMessage(error) });
    }

    return reply.send({
      data: [{ b64_json: result.b64Json, revised_prompt: result.revisedPrompt, mime_type: result.mimeType }],
    });
  });
}

/** 激活凭据 → ProviderConfig。provider 缺省视为 openai（兼容历史数据）。 */
function toProviderConfig(creds: {
  apiBaseUrl: string;
  apiKey: string;
  provider?: string;
  model?: string;
}): ProviderConfig {
  return {
    provider: creds.provider ?? "openai",
    apiBaseUrl: creds.apiBaseUrl,
    apiKey: creds.apiKey,
    model: creds.model,
  };
}

/** web JSON body → OpenAIImageRequest。已知字段抽出来，其余进 extra 透传。 */
function toGenerateRequest(body: Record<string, unknown>): OpenAIImageRequest {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!(KNOWN_GENERATE_FIELDS as readonly string[]).includes(key)) {
      extra[key] = value;
    }
  }
  return {
    model: String(body.model),
    prompt: String(body.prompt),
    size: String(body.size ?? "1024x1024"),
    resolution: optionalString(body.companion_resolution),
    background: String(body.background ?? "auto"),
    outputFormat: String(body.output_format ?? "png"),
    extra,
  };
}

/** 解析后的 multipart → OpenAIImageEditRequest。 */
function toEditRequest(parsed: {
  images: OpenAIImageEditRequest["images"];
  mask?: OpenAIImageEditRequest["mask"];
  fields: Record<string, string>;
}): OpenAIImageEditRequest {
  const editExtra: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.fields)) {
    if (!(KNOWN_EDIT_FIELDS as readonly string[]).includes(key)) {
      editExtra[key] = value;
    }
  }
  return {
    model: parsed.fields.model ?? "",
    prompt: parsed.fields.prompt ?? "",
    size: parsed.fields.size ?? "1024x1024",
    resolution: optionalString(parsed.fields.companion_resolution),
    background: parsed.fields.background ?? "auto",
    outputFormat: parsed.fields.output_format ?? "png",
    extra: {},
    images: parsed.images,
    mask: parsed.mask,
    editExtra,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "未知错误";
}

function logNormalizedImageRequest(
  app: FastifyInstance,
  request: {
    operation: "generate" | "edit";
    provider: string;
    model: string;
    size: string;
    resolution?: string;
    background: string;
    outputFormat: string;
  },
): void {
  if (process.env.GPT_IMAGE_STUDIO_DEBUG_REQUESTS !== "1") return;
  app.log.info(
    {
      event: "companion.image_request_normalized",
      operation: request.operation,
      provider: request.provider,
      model: request.model,
      size: request.size,
      resolution: request.resolution,
      background: request.background,
      output_format: request.outputFormat,
    },
    "normalized image request",
  );
}

function isJsonRequest(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function isMultipartRequest(contentType: string | undefined): boolean {
  return contentType?.toLowerCase().startsWith("multipart/form-data") ?? false;
}

function validateGenerationBody(body: Record<string, unknown>): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "请求体必须是 JSON object";
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    return "缺少 model";
  }
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return "缺少 prompt";
  }
  if ("b64_json" in body || "image" in body || "image[]" in body) {
    return "文生图请求不能包含图片内容";
  }
  return null;
}

export function validateEditMultipart(
  parsed: ParsedEditBody,
  security: CompanionSecurityConfig,
): string | null {
  if (parsed.images.length === 0) {
    return "编辑请求至少需要一张引用图片";
  }
  if (parsed.images.length > security.maxEditImages) {
    return `编辑请求最多支持 ${security.maxEditImages} 张引用图片`;
  }

  const files = parsed.mask ? [...parsed.images, parsed.mask] : parsed.images;
  for (const file of files) {
    if (!file.mimeType) {
      return "图片 part 缺少 Content-Type";
    }
    if (file.blob.length === 0) {
      return "图片 part 不能为空";
    }

    if (file === parsed.mask && file.mimeType !== "image/png") {
      return "mask 必须是 image/png";
    }
    if (file !== parsed.mask && !security.allowedEditImageMimeTypes.includes(file.mimeType)) {
      return `不支持的图片类型：${file.mimeType}`;
    }
  }

  return null;
}
