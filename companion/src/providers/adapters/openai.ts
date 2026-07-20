/**
 * OpenAI Images API 原生 adapter。
 *
 * 这是 canonical 协议的「原生实现」——入参出参都是 OpenAI 形状，翻译层实质是
 * 「原样转发 + 原样解析」，不做任何字段裁剪或 size 翻译。
 *
 *   文生图：POST {apiBaseUrl}/generations（JSON）
 *   图片编辑：POST {apiBaseUrl}/edits（multipart/form-data，image[] 数组 + 可选 mask）
 *
 * extra 字段（quality / stream / 任何 web 发出的其余字段）原样透传，这是 OpenAI
 * 相对其他 provider 的关键区别——其他兼容 provider 都要裁剪。
 *
 * 能力数据（capability/sizeConstraints/resolutionOptions）统一在
 * providerProfiles.ts + profiles/openai.json。
 */

import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCallOptions,
  ProviderConfig,
} from "../types.js";
import { getProviderProfile } from "../providerProfiles.js";
import {
  parseImagesResponse,
  postJson,
  postMultipart,
} from "../providerHttp.js";
import { getDefaultModel } from "../../providerPresets.js";

const OPENAI_PROFILE = getProviderProfile("openai")!;

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  capability: OPENAI_PROFILE.capability,
  sizeConstraints: OPENAI_PROFILE.sizeConstraints,
  resolutionOptions: OPENAI_PROFILE.resolutionOptions,

  describe(config: ProviderConfig) {
    return { label: config.model ?? getDefaultModel("openai")!, providerId: "openai" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    // 透传：model/prompt + 已知字段 + web 发出的所有其余字段（quality/stream/...）。
    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      {
        ...request.extra,
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        background: request.background,
        output_format: request.outputFormat,
      },
      options,
    );
    return parseImagesResponse(response, "OpenAI");
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
    options?: ProviderCallOptions,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/edits`;
    const form = buildEditMultipart(request);

    const response = await postMultipart(
      apiUrl,
      {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${form.boundary}`,
      },
      new Uint8Array(form.body),
      options,
    );

    return parseImagesResponse(response, "OpenAI");
  },
};

/**
 * 把 OpenAI 形状的 edit 请求重新组装成 multipart/form-data。
 * 重建而非透传是为了让 adapter 形状统一——所有 provider 收到的都是结构化字段。
 * 字段顺序：先文本字段，再 image[]，最后 mask。
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
