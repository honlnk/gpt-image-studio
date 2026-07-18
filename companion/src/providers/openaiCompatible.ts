/**
 * OpenAI 兼容 Images API adapter 工厂。
 *
 * 市面上大量图片 provider 对外挂 `/images/generations` 端点、用 Bearer 鉴权、
 * 返回 data[].b64_json 或 data[].url——"请求/响应骨架像 OpenAI"，但在字段裁剪、
 * 响应解析、edit 路径上有细微差异。本工厂把这层共性固化，让新增此类 provider
 * 只需声明差异点（一个配置对象 + 一个 size 规整函数），无需手写 HTTP/解析样板。
 *
 * 复用的固定骨架（工厂内部实现，各 provider 不再重复）：
 *   - URL 拼接：{apiBaseUrl}/generations 或 /edits
 *   - Bearer 鉴权头
 *   - postJson 发请求、上游断开统一文案
 *   - 响应解析（data_b64 / data_url 两种）
 *   - 能力数据从 getProviderProfile 读取
 *
 * 由调用方声明的差异点（OpenAICompatibleConfig）：
 *   - fieldMode：透传 extra 字段 vs 严格裁剪
 *   - requiredFields：固定附加的必填字段（如 doubao 的 watermark=false）
 *   - responseShape：响应是 data[].b64_json 还是 data[].url
 *   - editMode：edit 走 multipart 端点 / image 字段 / 不支持
 *   - normalizeSize：size 规整函数（各家算法不同，见下文说明）
 *
 * === 为什么 size 是函数注入而不是配置枚举 ===
 *
 * size 是 provider 差异最大的维度：GLM 要对齐 32 倍数，豆包要双像素约束，
 * Grok 要翻译成 aspect_ratio 枚举，Together 要拆成 width+height 两个整数。
 * 做成枚举要么覆盖不全（每加一种就改工厂），要么枚举值爆炸。
 * 函数注入让每个 provider 保留自己的算法，工厂只负责调用——遵循
 * providerProfiles.ts 的原则：「数据值的不同」配置化，「算法的不同」留代码。
 *
 * === 为什么不覆盖 openai / grok ===
 *
 * openai 是纯透传型（extra 字段原样转发，含 quality/stream 等），与工厂的
 * "组装请求体"模式天然冲突——透传需要保留 web 发来的全部未知字段，而工厂的
 * strict 模式恰恰相反。grok 的 size→aspect_ratio+resolution 枚举翻译是高度
 * 自定义逻辑，且 edit 用 image_url 形状，不适合任何 editMode 枚举。
 * 这两个 adapter 保持手写，不强塞进工厂。
 *
 * 详见 docs/companion-providers-plan.md「OpenAI 兼容工厂」一节。
 */

import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderConfig,
  SizeConstraints,
} from "./types.js";
import { getProviderProfile } from "./providerProfiles.js";
import {
  extractErrorMessage,
  parseImagesResponse,
  postJson,
  safeJsonParse,
  UPSTREAM_DISCONNECT_MESSAGE,
} from "./providerHttp.js";
import { getDefaultModel } from "../providerPresets.js";
import { urlToB64 } from "./urlToB64.js";

/**
 * 工厂配置。每个 OpenAI 兼容 provider 用一个此对象 + 一个 normalizeSize 函数
 * 即可完成接入。
 */
export type OpenAICompatibleConfig = {
  /** provider id，必须与 profiles/{id}.json、preset.id、registry key 一致。 */
  id: string;

  /**
   * 请求体裁剪模式：
   *   - "passthrough"：model/prompt/size + background/output_format + extra 全带上。
   *                    适用于接受标准 OpenAI 字段的 provider（如 DeepInfra）。
   *   - "strict"：只发 model/prompt/size + requiredFields，其余丢弃。
   *               适用于只认部分字段的 provider（如 doubao/glm）。
   */
  fieldMode: "passthrough" | "strict";

  /**
   * 固定附加到每次请求体的字段。
   * 例如 doubao 的 { response_format: "b64_json", watermark: false }。
   * strict 模式下与 model/prompt/size 一起作为唯一发送的字段；
   * passthrough 模式下合进已知字段一起发送。
   */
  requiredFields?: Record<string, unknown>;

  /**
   * 响应解析模式：
   *   - "data_b64"：标准 data[0].b64_json（doubao/DeepInfra），直接返回。
   *   - "data_url"：data[0].url（glm），需 urlToB64 下载转换。
   */
  responseShape: "data_b64" | "data_url";

  /**
   * edit（图片编辑）模式：
   *   - "none"：不支持编辑。capability.edit 应为 false，route 层返回 501。
   *   - "image_field"：参考图作为 JSON 的 image 字段塞进 /generations（doubao）。
   *   - "multipart"：标准 multipart/form-data 走 /edits 端点（DeepInfra/openai）。
   */
  editMode: "none" | "image_field" | "multipart";

  /**
   * size 规整函数。把 web 发来的 OpenAI 形状 size（如 "1024x1024"/"16:9"/"auto"）
   * 转成该 provider 合法的 size 字符串。各 provider 的算法保留在自己的 adapter 文件，
   * 工厂只调用。constraints 从 profiles/{id}.json 的 sizeConstraints 传入。
   */
  normalizeSize: (size: string, constraints: SizeConstraints) => string;
};

/**
 * 用配置创建一个 OpenAI 兼容 adapter。
 *
 * 返回的 ProviderAdapter 已实现 describe/generate/edit（edit 按 editMode 决定是否提供），
 * 能力数据（capability/sizeConstraints/resolutionOptions）从 profiles/{id}.json 读取。
 */
export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleConfig,
): ProviderAdapter {
  const loaded = getProviderProfile(config.id);
  if (!loaded) {
    throw new Error(
      `createOpenAICompatibleAdapter: 找不到 profiles/${config.id}.json，` +
        `请确认文件名与 id 一致。`,
    );
  }
  // 固化非空类型：getProviderProfile 返回 | undefined，守卫后 narrowing 不会传入
  // 嵌套的 generate/edit 闭包，这里赋给常量让闭包拿到确定的 ProviderProfile。
  const PROFILE = loaded;

  const baseAdapter = {
    id: config.id,
    capability: PROFILE.capability,
    sizeConstraints: PROFILE.sizeConstraints,
    resolutionOptions: PROFILE.resolutionOptions,

    describe(providerConfig: ProviderConfig) {
      return {
        label: providerConfig.model ?? getDefaultModel(config.id)!,
        providerId: config.id,
      };
    },
  };

  async function generate(
    request: OpenAIImageRequest,
    providerConfig: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${providerConfig.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    const model = providerConfig.model ?? getDefaultModel(config.id)!;
    const size = config.normalizeSize(request.size, PROFILE.sizeConstraints);

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${providerConfig.apiKey}` },
      buildGenerateBody(request, model, size, config),
    );

    return parseResponse(response, config, config.id);
  }

  // edit 按模式决定是否实现
  const edit =
    config.editMode === "none"
      ? undefined
      : config.editMode === "image_field"
        ? createImageFieldEdit(config, PROFILE.sizeConstraints)
        : createMultipartEdit(config, PROFILE.sizeConstraints);

  return { ...baseAdapter, generate, edit };
}

/**
 * 组装文生图请求体。
 * passthrough：model/prompt/size + background/output_format + extra + requiredFields
 * strict：model/prompt/size + requiredFields（丢弃其余）
 */
function buildGenerateBody(
  request: OpenAIImageRequest,
  model: string,
  size: string,
  config: OpenAICompatibleConfig,
): Record<string, unknown> {
  if (config.fieldMode === "passthrough") {
    return {
      ...request.extra,
      model,
      prompt: request.prompt,
      size,
      background: request.background,
      output_format: request.outputFormat,
      ...config.requiredFields,
    };
  }

  // strict：只发 model/prompt/size + requiredFields
  return {
    model,
    prompt: request.prompt,
    size,
    ...config.requiredFields,
  };
}

/**
 * 按 responseShape 解析响应。
 * data_b64：取 data[0].b64_json（标准 OpenAI 形状）
 * data_url：取 data[0].url，urlToB64 下载转换
 */
async function parseResponse(
  response: Response,
  config: OpenAICompatibleConfig,
  providerLabel: string,
): Promise<OpenAIImageResult> {
  if (config.responseShape === "data_b64") {
    // parseImagesResponse 内部已处理错误提取 + MIME 嗅探
    return parseImagesResponse(response, providerLabel);
  }

  // data_url：glm 风格，响应是 data[0].url（有时效），需下载转 b64
  const payload = safeJsonParse(await response.text());
  if (!response.ok) {
    const detail = extractErrorMessage(payload);
    throw new Error(detail ?? `请求失败：HTTP ${response.status}`);
  }
  const url = payload?.data?.[0]?.url;
  if (!url) {
    throw new Error(
      extractErrorMessage(payload) ?? `${providerLabel} 响应中没有 data[0].url`,
    );
  }
  const { b64Json, mimeType } = await urlToB64(url);
  return { b64Json, mimeType };
}

// ===== edit 模式：image_field（参考图作为 JSON 的 image 字段，doubao 风格）=====

function createImageFieldEdit(
  config: OpenAICompatibleConfig,
  constraints: SizeConstraints,
) {
  return async function edit(
    request: OpenAIImageEditRequest,
    providerConfig: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const reference = request.images[0];
    if (!reference) {
      throw new Error(`${config.id} 图生图需要至少一张参考图。`);
    }

    const apiUrl = `${providerConfig.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    const model = providerConfig.model ?? getDefaultModel(config.id)!;
    const size = config.normalizeSize(request.size, constraints);
    const imageDataUrl = `data:${reference.mimeType};base64,${reference.blob.toString("base64")}`;

    const response = await postJson(
      apiUrl,
      { Authorization: `Bearer ${providerConfig.apiKey}` },
      {
        model,
        prompt: request.prompt,
        size,
        image: imageDataUrl,
        ...config.requiredFields,
      },
    );

    return parseResponse(response, config, config.id);
  };
}

// ===== edit 模式：multipart（标准 multipart/form-data 走 /edits 端点，DeepInfra/openai 风格）=====

function createMultipartEdit(
  config: OpenAICompatibleConfig,
  constraints: SizeConstraints,
) {
  return async function edit(
    request: OpenAIImageEditRequest,
    providerConfig: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${providerConfig.apiBaseUrl.replace(/\/+$/, "")}/edits`;
    const model = providerConfig.model ?? getDefaultModel(config.id)!;
    const size = config.normalizeSize(request.size, constraints);
    const form = buildMultipartBody(model, request, size, config);

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerConfig.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${form.boundary}`,
        },
        body: new Uint8Array(form.body),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    return parseResponse(response, config, config.id);
  };
}

/**
 * 组装 multipart/form-data 请求体（用于 multipart edit 模式）。
 * 字段顺序：文本字段 → image[] 数组 → mask（可选）。
 */
function buildMultipartBody(
  model: string,
  request: OpenAIImageEditRequest,
  size: string,
  config: OpenAICompatibleConfig,
): { boundary: string; body: Buffer } {
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

  addField("model", model);
  addField("prompt", request.prompt);
  addField("size", size);
  // passthrough 模式带上 background/output_format；strict 模式不带
  if (config.fieldMode === "passthrough") {
    addField("background", request.background);
    addField("output_format", request.outputFormat);
  }
  // 固定必填字段
  for (const [key, value] of Object.entries(config.requiredFields ?? {})) {
    addField(key, String(value));
  }
  // extra 文本字段（仅 passthrough 模式）
  if (config.fieldMode === "passthrough") {
    for (const [key, value] of Object.entries(request.editExtra)) {
      addField(key, value);
    }
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
