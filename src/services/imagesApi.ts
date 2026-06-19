import type { ApiMode, GenerationParams, PromptMode, PromptWordbanks } from "../types/studio";
import { buildImagePrompt } from "./promptBuilder";

type PartialImageEvent = {
  b64Json: string;
  partialImageIndex?: number;
};

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

type ImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
  error?: {
    message?: string;
  };
};

type ResponsesOutputItem = {
  type?: string;
  result?: unknown;
  revised_prompt?: string;
};

type ResponsesApiResponse = {
  output?: ResponsesOutputItem[];
  error?: {
    message?: string;
  };
};

type StreamCompletedImageItem = {
  b64_json?: string;
  revised_prompt?: string;
};

export type ImageApiResult = {
  b64Json: string;
  revisedPrompt?: string;
};

export const PROMPT_REWRITE_GUARD_PREFIX =
  "Use the following text as the complete prompt. Do not rewrite it:";

export function normalizePromptRewriteGuardText(text?: string) {
  const normalized = text?.trim();
  return normalized || PROMPT_REWRITE_GUARD_PREFIX;
}

export function applyPromptRewriteGuard(
  prompt: string,
  enabled: boolean,
  guardText?: string,
) {
  if (!enabled) return prompt;
  const normalizedGuardText = normalizePromptRewriteGuardText(guardText);
  if (prompt.startsWith(`${normalizedGuardText}\n`)) return prompt;
  return `${normalizedGuardText}\n${prompt}`;
}

export async function generateImage(input: GenerateImageInput) {
  const params = imageApiParams(input.model, input.params, input.apiMode);
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
      params: input.params,
    });
  }

  return generateImageViaImagesApi({
    ...input,
    prompt,
    requestParams: params,
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
    requestParams: imageApiParams(input.model, input.params, input.apiMode),
  });
}

async function generateImageViaImagesApi(input: GenerateImageInput & {
  prompt: string;
  requestParams: Record<string, string>;
}) {
  let response: Response;
  try {
    response = await fetch(buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "images", "generations"), {
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
    });
  } catch {
    throw new Error(
      "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。",
    );
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

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

  let response: Response;
  try {
    response = await fetch(buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "images", "edits"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      body,
    });
  } catch (error) {
    console.error("[imagesApi] edit request failed before response", JSON.stringify({
      imageCount: input.images.length,
      images: imageDebugInfo(input.images),
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new Error(
      "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。",
    );
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

  if (input.streamImages && isEventStreamResponse(response)) {
    return parseImagesApiStreamResponse(response, input.onPartialImage);
  }

  const payload = await parseImageResponse(response);
  return extractImageResult(payload);
}

async function generateImageViaResponses(input: GenerateImageInput & { prompt: string }) {
  let response: Response;
  try {
    response = await fetch(buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "responses", "responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: input.prompt,
        tools: [createResponsesImageTool(input.params, false, input.streamImages, input.streamPartialImages)],
        tool_choice: "required",
        ...(input.streamImages ? { stream: true } : {}),
      }),
    });
  } catch {
    throw new Error(
      "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。",
    );
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

  if (input.streamImages && isEventStreamResponse(response)) {
    return parseResponsesApiStreamResponse(response, input.onPartialImage);
  }

  const payload = await parseJsonResponse<ResponsesApiResponse>(response);
  return extractResponsesImageResult(payload);
}

async function editImageViaResponses(input: EditImageInput & { prompt: string }) {
  const inputImageDataUrls = await Promise.all(
    input.images.map((image) => blobToDataUrl(image.blob)),
  );
  const maskDataUrl = input.mask ? await blobToDataUrl(input.mask.blob) : undefined;

  let response: Response;
  try {
    response = await fetch(buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "responses", "responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        input: createResponsesInput(input.prompt, inputImageDataUrls),
        tools: [
          createResponsesImageTool(
            input.params,
            true,
            input.streamImages,
            input.streamPartialImages,
            maskDataUrl,
          ),
        ],
        tool_choice: "required",
        ...(input.streamImages ? { stream: true } : {}),
      }),
    });
  } catch {
    throw new Error(
      "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。",
    );
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response));
  }

  if (input.streamImages && isEventStreamResponse(response)) {
    return parseResponsesApiStreamResponse(response, input.onPartialImage);
  }

  const payload = await parseJsonResponse<ResponsesApiResponse>(response);
  return extractResponsesImageResult(payload);
}

function createResponsesImageTool(
  params: GenerationParams,
  isEdit: boolean,
  streamImages = false,
  streamPartialImages = 1,
  maskDataUrl?: string,
) {
  return {
    type: "image_generation",
    action: isEdit ? "edit" : "generate",
    size: apiSize(params),
    quality: params.quality,
    background: params.background,
    output_format: params.outputFormat,
    ...(streamImages ? { partial_images: normalizeStreamPartialImages(streamPartialImages) } : {}),
    ...(maskDataUrl ? {
      input_image_mask: {
        image_url: maskDataUrl,
      },
    } : {}),
  };
}

function createResponsesInput(prompt: string, inputImageDataUrls: string[]) {
  if (!inputImageDataUrls.length) return prompt;
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...inputImageDataUrls.map((dataUrl) => ({
          type: "input_image",
          image_url: dataUrl,
        })),
      ],
    },
  ];
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

export function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export function normalizeApiBaseUrl(
  url: string,
  mode: "origin" | "full" = "full",
  apiMode: ApiMode = "images",
) {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  if (mode === "origin") {
    return `${trimmed}${apiMode === "responses" ? "/v1" : "/v1/images"}`;
  }

  if (apiMode === "responses") {
    return trimmed.replace(/\/v1\/images$/i, "/v1");
  }

  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/images`;
  }

  return trimmed;
}

function buildApiEndpoint(
  apiBaseUrl: string,
  apiBaseUrlMode: "origin" | "full",
  apiMode: ApiMode,
  path: string,
) {
  return `${normalizeApiBaseUrl(apiBaseUrl, apiBaseUrlMode, apiMode)}/${path}`;
}

function imageApiParams(model: string, params: GenerationParams, apiMode: ApiMode = "images") {
  validateBackground(model, params.background, apiMode);

  return {
    size: apiSize(params),
    background: params.background,
    output_format: params.outputFormat,
  };
}

function validateBackground(
  model: string,
  background: GenerationParams["background"],
  apiMode: ApiMode = "images",
) {
  if (apiMode === "images" && model === "gpt-image-2" && background === "transparent") {
    throw new Error("gpt-image-2 当前不支持透明背景，请选择自动或不透明背景。");
  }
}

function apiSize(params: GenerationParams) {
  if (params.size === "auto") {
    return "auto";
  }

  if (params.size.includes(":") || params.size === "custom") {
    validateCustomSize(params.width, params.height);
    return `${params.width}x${params.height}`;
  }

  return params.size;
}

function isEventStreamResponse(response: Response) {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") ?? false;
}

async function parseImageResponse(response: Response) {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ImageApiResponse) : {};

  if (!response.ok) {
    const statusMessage = `请求失败：HTTP ${response.status}`;
    const detail = payload.error?.message;
    const message = detail ? `${statusMessage}：${detail}` : statusMessage;
    throw new Error(message);
  }

  return payload;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

function extractImageResult(payload: ImageApiResponse): ImageApiResult {
  const item = payload.data?.[0];
  const imageData = item?.b64_json;

  if (!imageData) {
    throw new Error("响应中没有 data[0].b64_json。");
  }

  return {
    b64Json: imageData,
    revisedPrompt: item.revised_prompt,
  };
}

function extractResponsesImageResult(payload: ResponsesApiResponse): ImageApiResult {
  const item = payload.output?.find((outputItem) => outputItem?.type === "image_generation_call");
  const imageData = getResponsesImageResultBase64(item?.result);

  if (!imageData) {
    throw new Error("响应中没有 image_generation_call 结果。");
  }

  return {
    b64Json: imageData,
    revisedPrompt: item?.revised_prompt,
  };
}

function getResponsesImageResultBase64(result: unknown): string {
  if (typeof result === "string" && result.trim()) return result;
  if (Array.isArray(result)) {
    for (const item of result) {
      const b64: string = getResponsesImageResultBase64(item);
      if (b64) return b64;
    }
    return "";
  }
  if (!result || typeof result !== "object") return "";

  const record = result as Record<string, unknown>;
  return typeof record.b64_json === "string"
    ? record.b64_json
    : typeof record.base64 === "string"
      ? record.base64
      : typeof record.image === "string"
        ? record.image
        : typeof record.data === "string"
          ? record.data
          : getResponsesImageResultBase64(record.data);
}

async function getApiErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) return `请求失败：HTTP ${response.status}`;

  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const detail = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message || payload.message;
    return detail ? `请求失败：HTTP ${response.status}：${detail}` : `请求失败：HTTP ${response.status}`;
  } catch {
    return `请求失败：HTTP ${response.status}`;
  }
}

function parseServerSentEventBlock(block: string) {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).replace(/^ /, ""));
  }

  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") return null;
  return data;
}

function getStreamEventErrorMessage(event: Record<string, unknown>) {
  const error = event.error;
  if (isRecordValue(error)) {
    const message = getStringValue(error, "message");
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) return error;

  const type = getStringValue(event, "type");
  if (type?.endsWith(".failed")) {
    return getStringValue(event, "message") ?? "流式请求失败。";
  }

  return null;
}

async function readJsonServerSentEvents(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
) {
  if (!response.body) throw new Error("接口未返回可读取的流式响应。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = async (block: string) => {
    const data = parseServerSentEventBlock(block);
    if (!data) return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("流式响应包含无法解析的 JSON 事件。");
    }
    if (!isRecordValue(event)) return;

    const errorMessage = getStreamEventErrorMessage(event);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    await onEvent(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.search(/\r?\n\r?\n/);
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(separatorIndex + separator.length);
      await processBlock(block);
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) await processBlock(buffer);
}

async function parseImagesApiStreamResponse(
  response: Response,
  onPartialImage?: (event: PartialImageEvent) => void,
): Promise<ImageApiResult> {
  const completedItems: StreamCompletedImageItem[] = [];
  let resultPayload: ImageApiResponse | null = null;

  await readJsonServerSentEvents(response, (event) => {
    const type = getStringValue(event, "type");
    const object = getStringValue(event, "object");
    if (type === "image_generation.partial_image" || type === "image_edit.partial_image") {
      const b64 = getStringValue(event, "b64_json");
      if (b64) {
        onPartialImage?.({
          b64Json: b64,
          partialImageIndex: getNumberValue(event, "partial_image_index"),
        });
      }
      return;
    }

    if (object === "image.generation.result" || object === "image.edit.result") {
      resultPayload = normalizeImageApiPayload(event);
      return;
    }

    if (type === "image_generation.completed" || type === "image_edit.completed") {
      completedItems.push({
        b64_json: getStringValue(event, "b64_json"),
        revised_prompt: getStringValue(event, "revised_prompt"),
      });
    }
  });

  if (resultPayload) {
    return extractImageResult(resultPayload);
  }

  const item = completedItems.find((entry) => entry.b64_json);
  if (!item?.b64_json) {
    throw new Error("流式接口未返回最终图片数据。");
  }

  return {
    b64Json: item.b64_json,
    revisedPrompt: item.revised_prompt,
  };
}

async function parseResponsesApiStreamResponse(
  response: Response,
  onPartialImage?: (event: PartialImageEvent) => void,
): Promise<ImageApiResult> {
  let completedPayload: ResponsesApiResponse | null = null;
  const outputItems: ResponsesOutputItem[] = [];

  await readJsonServerSentEvents(response, (event) => {
    const type = getStringValue(event, "type");
    if (type === "response.image_generation_call.partial_image") {
      const b64 = getStringValue(event, "partial_image_b64");
      if (b64) {
        onPartialImage?.({
          b64Json: b64,
          partialImageIndex: getNumberValue(event, "partial_image_index"),
        });
      }
      return;
    }

    const payload = getResponsesStreamPayload(event);
    if (!payload) return;

    if (type === "response.output_item.done" && Array.isArray(payload.output)) {
      outputItems.push(...payload.output);
      return;
    }

    completedPayload = payload;
  });

  const payload = completedPayload ?? (outputItems.length ? { output: outputItems } : null);
  if (!payload) {
    throw new Error("流式接口未返回最终图片数据。");
  }

  const imageItem = payload.output?.find((item) => getResponsesImageResultBase64(item.result));
  if (!imageItem) {
    throw new Error("流式接口未返回 image_generation_call 结果。");
  }

  const b64Json = getResponsesImageResultBase64(imageItem.result);
  if (!b64Json) {
    throw new Error("流式接口未返回最终图片数据。");
  }

  return {
    b64Json,
    revisedPrompt: imageItem.revised_prompt,
  };
}

function getResponsesStreamPayload(event: Record<string, unknown>): ResponsesApiResponse | null {
  const response = event.response;
  if (isRecordValue(response)) return response as ResponsesApiResponse;

  const item = event.item;
  if (isRecordValue(item) && item.type === "image_generation_call") {
    return { output: [item as ResponsesOutputItem] };
  }

  return null;
}

function normalizeImageApiPayload(value: unknown): ImageApiResponse {
  if (Array.isArray(value)) return { data: value as ImageApiResponse["data"] };
  if (value && typeof value === "object") return value as ImageApiResponse;
  return { data: [] };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumberValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function blobToDataUrl(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function normalizeStreamPartialImages(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(3, Math.max(0, Math.trunc(numeric))) as 0 | 1 | 2 | 3;
}

function validateCustomSize(width: number, height: number) {
  const error = getCustomSizeError(width, height);
  if (error) {
    throw new Error(error);
  }
}

export function getCustomSizeError(width: number, height: number) {
  const normalizedWidth = Math.trunc(width);
  const normalizedHeight = Math.trunc(height);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    normalizedWidth !== width ||
    normalizedHeight !== height
  ) {
    return "自定义尺寸的宽高必须是整数。";
  }

  if (
    normalizedWidth < 16 ||
    normalizedHeight < 16 ||
    normalizedWidth > 3840 ||
    normalizedHeight > 3840 ||
    normalizedWidth % 16 !== 0 ||
    normalizedHeight % 16 !== 0
  ) {
    return "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。";
  }

  const pixels = normalizedWidth * normalizedHeight;
  if (pixels < 655360 || pixels > 8294400) {
    return "自定义尺寸的总像素必须在 655,360 到 8,294,400 之间。";
  }

  const longSide = Math.max(normalizedWidth, normalizedHeight);
  const shortSide = Math.min(normalizedWidth, normalizedHeight);
  if (longSide / shortSide > 3) {
    return "自定义尺寸的长边与短边比例不能超过 3:1。";
  }

  return "";
}
