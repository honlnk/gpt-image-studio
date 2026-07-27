import type {
  ImageApiResponse,
  ImageApiResult,
  PartialImageEvent,
  ResponsesApiResponse,
  ResponsesOutputItem,
  StreamCompletedImageItem,
} from "./types.js";

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

/** 从 Images API 载荷里抽出最终图片结果（data[0].b64_json）。 */
export function extractImageResult(payload: ImageApiResponse): ImageApiResult {
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

/** 从 Responses API 载荷里抽出最终图片结果（output[type=image_generation_call]）。 */
export function extractResponsesImageResult(payload: ResponsesApiResponse): ImageApiResult {
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

/**
 * 从 Responses API 的 image_generation_call.result 里递归找 base64 字符串。
 *
 * 兼容多种历史响应形状（string / array / {b64_json} / {base64} / {image} / {data}）。
 * 被流式与非流式解析共用，故放在 streaming.ts 而非 responses.ts。
 */
export function getResponsesImageResultBase64(result: unknown): string {
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
