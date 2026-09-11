import type {
  ImageApiResponse,
  ImageApiResult,
  PartialImageEvent,
  ResponsesApiResponse,
  ResponsesOutputItem,
  StreamCompletedImageItem,
} from "./types.js";
import {
  DIRECT_MODE_FALLBACK_HINT,
  downloadImageUrlAsBase64,
} from "./imageUrlDownload.js";

/**
 * SSE 流式响应解析 + 响应载荷提取。
 *
 * 这里同时收纳 Images API 与 Responses API 两条流式路径的解析逻辑，
 * 以及它们共用的"从响应载荷里抽出最终图片 base64"的 helper。
 * 后者（getResponsesImageResultBase64 / extractResponsesImageResult）
 * 历史上住在主文件里，被流式解析与非流式解析同时调用——
 * 放在本模块（而非 responses.ts）是为了避免 streaming ↔ responses 互相 import。
 */

export async function readJsonServerSentEvents(
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

export async function parseImagesApiStreamResponse(
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
        url: getStringValue(event, "url"),
        revised_prompt: getStringValue(event, "revised_prompt"),
      });
    }
  });

  if (resultPayload) {
    return extractImageResult(resultPayload);
  }

  const b64Item = completedItems.find((entry) => entry.b64_json);
  if (b64Item?.b64_json) {
    return {
      b64Json: b64Item.b64_json,
      revisedPrompt: b64Item.revised_prompt,
    };
  }

  // 部分中转的 completed 事件只带链接：浏览器内下载转 base64。
  const urlItem = completedItems.find((entry) => entry.url);
  if (urlItem?.url) {
    const { b64Json, mimeType } = await downloadImageUrlAsBase64(urlItem.url);
    return {
      b64Json,
      mimeType,
      revisedPrompt: urlItem.revised_prompt,
    };
  }

  throw new Error(
    `流式接口未返回最终图片数据，服务商返回的数据可能不标准。${DIRECT_MODE_FALLBACK_HINT}`,
  );
}

export async function parseResponsesApiStreamResponse(
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

  const imageItem = payload.output?.find(
    (item) =>
      getResponsesImageResultBase64(item.result) || getResponsesImageUrl(item.result),
  );
  if (!imageItem) {
    throw new Error("流式接口未返回 image_generation_call 结果。");
  }

  const result = await resolveResponsesImageItemResult(imageItem);
  if (!result) {
    throw new Error("流式接口未返回最终图片数据。");
  }
  return result;
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

/**
 * 从 Images API 载荷里抽出最终图片结果。
 *
 * 优先取 data[0].b64_json（标准形状）；缺失时取 data[0].url 在浏览器内
 * 下载转 base64——部分中转无视 response_format=b64_json 只返回图片链接。
 */
export async function extractImageResult(
  payload: ImageApiResponse,
): Promise<ImageApiResult> {
  const item = payload.data?.[0];
  const imageData = item?.b64_json;

  if (imageData) {
    return {
      b64Json: imageData,
      revisedPrompt: item.revised_prompt,
    };
  }

  const url = item?.url;
  if (url) {
    const { b64Json, mimeType } = await downloadImageUrlAsBase64(url);
    return {
      b64Json,
      mimeType,
      revisedPrompt: item.revised_prompt,
    };
  }

  throw new Error(
    `服务商返回的数据不标准：响应中没有 data[0].b64_json 或 data[0].url。${DIRECT_MODE_FALLBACK_HINT}`,
  );
}

/**
 * 从 Responses API 载荷里抽出最终图片结果（output[type=image_generation_call]）。
 */
export async function extractResponsesImageResult(
  payload: ResponsesApiResponse,
): Promise<ImageApiResult> {
  const item = payload.output?.find(
    (outputItem) =>
      getResponsesImageResultBase64(outputItem?.result) ||
      getResponsesImageUrl(outputItem?.result),
  );

  const result = await resolveResponsesImageItemResult(item);
  if (!result) {
    throw new Error(
      `服务商返回的数据不标准：响应中没有 image_generation_call 结果。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }
  return result;
}

/**
 * 从单个 image_generation_call 项里解析最终图片：b64 优先，URL 下载兜底。
 *
 * 返回 null 表示该项既无 base64 也无链接，由调用方决定报错文案。
 */
async function resolveResponsesImageItemResult(
  item: ResponsesOutputItem | undefined,
): Promise<ImageApiResult | null> {
  const b64Json = getResponsesImageResultBase64(item?.result);
  if (b64Json) {
    return {
      b64Json,
      revisedPrompt: item?.revised_prompt,
    };
  }

  const url = getResponsesImageUrl(item?.result);
  if (url) {
    const { b64Json: downloaded, mimeType } = await downloadImageUrlAsBase64(url);
    return {
      b64Json: downloaded,
      mimeType,
      revisedPrompt: item?.revised_prompt,
    };
  }

  return null;
}

/**
 * 从 Responses API 的 image_generation_call.result 里递归找 base64 字符串。
 *
 * 兼容多种历史响应形状（string / array / {b64_json} / {base64} / {image} / {data}）。
 * 被流式与非流式解析共用，故放在 streaming.ts 而非 responses.ts。
 */
export function getResponsesImageResultBase64(result: unknown): string {
  if (typeof result === "string" && result.trim()) {
    // base64 不可能包含 "://"；形如 http(s) 链接说明中转把 result 换成了图片地址，
    // 不是 base64——返回空串，让调用方走 getResponsesImageUrl 的下载兜底。
    if (isHttpUrlString(result.trim())) return "";
    return result;
  }
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

/**
 * 从 image_generation_call.result 里递归找 http(s) 图片链接。
 *
 * 与 getResponsesImageResultBase64 对称：b64 找不到时用它定位链接，
 * 由调用方在浏览器内下载转 base64。
 */
export function getResponsesImageUrl(result: unknown): string {
  if (typeof result === "string") {
    return isHttpUrlString(result.trim()) ? result.trim() : "";
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const url = getResponsesImageUrl(item);
      if (url) return url;
    }
    return "";
  }
  if (!result || typeof result !== "object") return "";

  const record = result as Record<string, unknown>;
  if (typeof record.url === "string" && isHttpUrlString(record.url.trim())) {
    return record.url.trim();
  }
  return getResponsesImageUrl(record.data);
}

function isHttpUrlString(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
