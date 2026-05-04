import type { GenerationParams } from "../types/studio";

type GenerateImageInput = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  params: GenerationParams;
};

type EditImageInput = GenerateImageInput & {
  images: Array<{
    blob: Blob;
    name: string;
  }>;
};

type ImageApiResponse = {
  data?: Array<{
    b64_json?: string;
  }>;
  error?: {
    message?: string;
  };
};

export async function generateImage(input: GenerateImageInput) {
  const params = imageApiParams(input.model, input.params);
  const response = await fetch(`${normalizeApiBaseUrl(input.apiBaseUrl)}/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      ...params,
    }),
  });

  const payload = await parseImageResponse(response);
  const imageData = payload.data?.[0]?.b64_json;

  if (!imageData) {
    throw new Error("响应中没有 data[0].b64_json。");
  }

  return imageData;
}

export async function editImage(input: EditImageInput) {
  const body = new FormData();
  body.append("model", input.model);
  body.append("prompt", input.prompt);
  input.images.forEach((image) => {
    body.append("image[]", image.blob, image.name);
  });
  const params = imageApiParams(input.model, input.params);
  Object.entries(params).forEach(([key, value]) => {
    body.append(key, value);
  });

  logImageRequest("edit", input.model, input.images);

  let response: Response;
  try {
    response = await fetch(`${normalizeApiBaseUrl(input.apiBaseUrl)}/edits`, {
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
      "网络请求失败：浏览器没有收到接口响应，可能是 CORS、代理中断或上传图片过大。",
    );
  }

  const payload = await parseImageResponse(response);
  const imageData = payload.data?.[0]?.b64_json;

  if (!imageData) {
    throw new Error("响应中没有 data[0].b64_json。");
  }

  return imageData;
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

function normalizeApiBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function imageApiParams(model: string, params: GenerationParams) {
  validateBackground(model, params.background);

  return {
    size: apiSize(params),
    quality: params.quality,
    background: params.background,
    output_format: params.outputFormat,
  };
}

function validateBackground(
  model: string,
  background: GenerationParams["background"],
) {
  if (model === "gpt-image-2" && background === "transparent") {
    throw new Error("gpt-image-2 当前不支持透明背景，请选择自动或不透明背景。");
  }
}

function apiSize(params: GenerationParams) {
  if (params.size === "custom") {
    validateCustomSize(params.width, params.height);
    return `${params.width}x${params.height}`;
  }

  return params.size;
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

async function parseImageResponse(response: Response) {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ImageApiResponse) : {};

  if (!response.ok) {
    const message = payload.error?.message || `请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}
