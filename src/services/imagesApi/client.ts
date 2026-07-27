import type { ApiMode, GenerationParams, PromptMode, PromptWordbanks } from "../../types/studio";
import { buildImagePrompt } from "../promptBuilder";
import { applyPromptRewriteGuard } from "../promptRewriteGuard";
import {
  DEFAULT_SIZE_CONSTRAINTS,
  apiSize,
  validateBackground,
  type SizeConstraints,
} from "../sizeConstraints";
import {
  buildApiEndpoint,
  getApiErrorMessage,
  isEventStreamResponse,
  normalizeStreamPartialImages,
  parseImageResponse,
} from "./http.js";
import {
  editImageViaResponses,
  generateImageViaResponses,
} from "./responses.js";
import {
  extractImageResult,
  parseImagesApiStreamResponse,
} from "./streaming.js";
import type {
  ImageApiResult,
  PartialImageEvent,
} from "./types.js";

type GenerateImageInput = {
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiMode?: ApiMode;
  apiKey: string;
  model: string;
  prompt: string;
  promptMode?: PromptMode;
  promptWordbanks?: PromptWordbanks;
  promptRewriteGuardEnabled?: boolean;
  promptRewriteGuardText?: string;
  streamImages?: boolean;
  streamPartialImages?: number;
  onPartialImage?: (event: PartialImageEvent) => void;
  params: GenerationParams;
  /** 当前 provider 是否支持透明背景（来自 capability，未传则按 false 兜底）。 */
  supportsTransparent?: boolean;
  /** 当前 provider 的尺寸软约束（来自 sizeConstraints，未传则用 OpenAI 默认）。 */
  sizeConstraints?: SizeConstraints;
};

type EditImageInput = GenerateImageInput & {
  images: Array<{
    blob: Blob;
    name: string;
  }>;
  mask?: {
    blob: Blob;
    name: string;
  };
};

/** 连接被服务端主动断开时的统一文案。 */
const SERVER_DISCONNECTED_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

export async function generateImage(input: GenerateImageInput) {
  const requestParams = imageApiParams(
    input.model,
    input.params,
    input.apiMode,
    input.supportsTransparent ?? false,
    input.sizeConstraints ?? DEFAULT_SIZE_CONSTRAINTS,
  );
  const modePrompt = buildImagePrompt({
    prompt: input.prompt,
    mode: input.promptMode ?? "default",
    wordbanks: input.promptWordbanks,
  });
  const prompt = applyPromptRewriteGuard(
    modePrompt,
    input.promptRewriteGuardEnabled ?? false,
    input.promptRewriteGuardText,
  );

  if ((input.apiMode ?? "images") === "responses") {
    return generateImageViaResponses({
      ...input,
      prompt,
    });
  }

  return generateImageViaImagesApi({
    ...input,
    prompt,
    requestParams,
  });
}

export async function editImage(input: EditImageInput) {
  const modePrompt = buildImagePrompt({
    prompt: input.prompt,
    mode: input.promptMode ?? "default",
    wordbanks: input.promptWordbanks,
  });
  const prompt = applyPromptRewriteGuard(
    modePrompt,
    input.promptRewriteGuardEnabled ?? false,
    input.promptRewriteGuardText,
  );

  if ((input.apiMode ?? "images") === "responses") {
    return editImageViaResponses({
      ...input,
      prompt,
    });
  }

  return editImageViaImagesApi({
    ...input,
    prompt,
    requestParams: imageApiParams(
      input.model,
      input.params,
      input.apiMode,
      input.supportsTransparent ?? false,
      input.sizeConstraints ?? DEFAULT_SIZE_CONSTRAINTS,
    ),
  });
}

async function generateImageViaImagesApi(input: GenerateImageInput & {
  prompt: string;
  requestParams: Record<string, string>;
}) {
  const response = await postImagesApi(
    buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "images", "generations"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        ...input.requestParams,
        ...(input.streamImages ? {
          stream: true,
          partial_images: normalizeStreamPartialImages(input.streamPartialImages),
        } : {}),
      }),
    },
  );

  if (input.streamImages && isEventStreamResponse(response)) {
    return parseImagesApiStreamResponse(response, input.onPartialImage);
  }

  const payload = await parseImageResponse(response);
  return extractImageResult(payload);
}

async function editImageViaImagesApi(input: EditImageInput & {
  prompt: string;
  requestParams: Record<string, string>;
}) {
  const body = new FormData();
  body.append("model", input.model);
  body.append("prompt", input.prompt);
  input.images.forEach((image) => {
    body.append("image[]", image.blob, image.name);
  });
  if (input.mask) {
    body.append("mask", input.mask.blob, input.mask.name);
  }
  Object.entries(input.requestParams).forEach(([key, value]) => {
    body.append(key, value);
  });
  if (input.streamImages) {
    body.append("stream", "true");
    body.append("partial_images", String(normalizeStreamPartialImages(input.streamPartialImages)));
  }

  logImageRequest("edit", input.model, input.images);
  if (input.mask) {
    console.info("[imagesApi] mask payload", JSON.stringify({
      name: input.mask.name,
      sizeBytes: input.mask.blob.size,
      type: input.mask.blob.type || "unknown",
    }));
  }

  const response = await postImagesApi(
    buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "images", "edits"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      body,
    },
    {
      // edit 路径在 fetch 失败时额外打 imageDebugInfo 日志，便于诊断参考图上传问题。
      onFetchError: (error) => {
        console.error("[imagesApi] edit request failed before response", JSON.stringify({
          imageCount: input.images.length,
          images: imageDebugInfo(input.images),
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    },
  );

  if (input.streamImages && isEventStreamResponse(response)) {
    return parseImagesApiStreamResponse(response, input.onPartialImage);
  }

  const payload = await parseImageResponse(response);
  return extractImageResult(payload);
}

/**
 * 统一的 POST 请求封装：把"fetch + try/catch + !response.ok"三段重复样板收敛。
 *
 * - 网络层异常（fetch reject）转成统一文案（除 onFetchError 钩子外不打日志）。
 * - HTTP 非 2xx 转 getApiErrorMessage 后抛出。
 *
 * onFetchError 是为 editImageViaImagesApi 保留的诊断日志 hook。
 */
async function postImagesApi(
  url: string,
  init: RequestInit,
  options: { onFetchError?: (error: unknown) => void } = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    options.onFetchError?.(error);
    throw new Error(SERVER_DISCONNECTED_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

  return response;
}

function imageApiParams(
  model: string,
  params: GenerationParams,
  apiMode: ApiMode | undefined,
  supportsTransparent: boolean,
  sizeConstraints: SizeConstraints,
) {
  validateBackground(model, params.background, apiMode, supportsTransparent);

  return {
    size: apiSize(params, sizeConstraints),
    background: params.background,
    output_format: params.outputFormat,
  };
}

function logImageRequest(
  action: "edit",
  model: string,
  images: Array<{ blob: Blob; name: string }>,
) {
  console.info("[imagesApi] image request", JSON.stringify({
    action,
    model,
    imageCount: images.length,
    images: imageDebugInfo(images),
  }));
}

function imageDebugInfo(images: Array<{ blob: Blob; name: string }>) {
  return images.map((image) => ({
    name: image.name,
    sizeBytes: image.blob.size,
    type: image.blob.type || "unknown",
  }));
}
