import { blobToDataUrl } from "../../shared/blobConverters";
import type { GenerationParams } from "../../types/studio";
import {
  DEFAULT_SIZE_CONSTRAINTS,
  apiSize,
  type SizeConstraints,
} from "../sizeConstraints";
import {
  buildApiEndpoint,
  getApiErrorMessage,
  isEventStreamResponse,
  normalizeStreamPartialImages,
  parseJsonResponse,
} from "./http.js";
import {
  extractResponsesImageResult,
  parseResponsesApiStreamResponse,
} from "./streaming.js";
import type {
  ImageApiResult,
  PartialImageEvent,
  ResponsesApiResponse,
} from "./types.js";

/** 生成/编辑请求的公共输入字段（与 client.ts 的 GenerateImageInput 对齐）。 */
type ResponsesRequestInput = {
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiKey: string;
  model: string;
  prompt: string;
  params: GenerationParams;
  streamImages?: boolean;
  streamPartialImages?: number;
  onPartialImage?: (event: PartialImageEvent) => void;
  sizeConstraints?: SizeConstraints;
};

/** 编辑请求附加字段。 */
type ResponsesEditInput = ResponsesRequestInput & {
  images: Array<{ blob: Blob; name: string }>;
  mask?: { blob: Blob; name: string };
};

/** 连接被服务端主动断开时的统一文案（与 Images API 路径一致）。 */
const SERVER_DISCONNECTED_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

export async function generateImageViaResponses(
  input: ResponsesRequestInput,
): Promise<ImageApiResult> {
  const constraints = input.sizeConstraints ?? DEFAULT_SIZE_CONSTRAINTS;
  let response: Response;
  try {
    response = await fetch(
      buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "responses", "responses"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          input: input.prompt,
          tools: [
            createResponsesImageTool(
              input.params,
              false,
              input.streamImages,
              input.streamPartialImages,
              undefined,
              constraints,
            ),
          ],
          tool_choice: "required",
          ...(input.streamImages ? { stream: true } : {}),
        }),
      },
    );
  } catch {
    throw new Error(SERVER_DISCONNECTED_MESSAGE);
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

export async function editImageViaResponses(
  input: ResponsesEditInput,
): Promise<ImageApiResult> {
  const constraints = input.sizeConstraints ?? DEFAULT_SIZE_CONSTRAINTS;
  const inputImageDataUrls = await Promise.all(
    input.images.map((image) => blobToDataUrl(image.blob)),
  );
  const maskDataUrl = input.mask ? await blobToDataUrl(input.mask.blob) : undefined;

  let response: Response;
  try {
    response = await fetch(
      buildApiEndpoint(input.apiBaseUrl, input.apiBaseUrlMode, "responses", "responses"),
      {
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
              constraints,
            ),
          ],
          tool_choice: "required",
          ...(input.streamImages ? { stream: true } : {}),
        }),
      },
    );
  } catch {
    throw new Error(SERVER_DISCONNECTED_MESSAGE);
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
  sizeConstraints: SizeConstraints = DEFAULT_SIZE_CONSTRAINTS,
) {
  return {
    type: "image_generation",
    action: isEdit ? "edit" : "generate",
    size: apiSize(params, sizeConstraints),
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
