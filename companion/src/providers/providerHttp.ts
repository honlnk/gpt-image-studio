/**
 * 所有 provider adapter 共用的 HTTP/解析工具。
 *
 * 这里集中了此前散落在 7 个 adapter 里的真重复样板：
 *   1. safeJsonParse —— try { JSON.parse } catch { null }
 *   2. extractErrorMessage —— OpenAI 风格错误信息提取（统一超集）
 *   3. postJson / postMultipart —— fetch + 信号透传 + 错误分类的样板
 *
 * 不放这里的内容（各 adapter 的独有算法）：
 *   - normalize*Size 尺寸规整（边界条件各异，不可合并）
 *   - buildBody / parseResponse（协议形状不同）
 *   - DEFAULT_*_BASE_URL / DEFAULT_*_MODEL（连接信息，归 providerPresets.ts）
 *
 * parseImagesResponse 是例外——它解析的是 OpenAI Images API 标准响应形状
 * data[0].b64_json，属于"协议标准"而非"provider 差异"，因此与 HTTP 工具放一起，
 * 由 OpenAI 兼容家族（openai / grok）共用。
 *
 * 网络层异常由 providerErrors.ts 的 classifyNetworkError 分类；HTTP 层非 2xx 由
 * buildHttpErrorFromResponse 分类。两者都产出 ProviderCallError，让 route 层能向
 * Web 透传 category（dns / tls / reset / http_4xx / ...）。
 */

import type { OpenAIImageResult } from "./types.js";
import { sniffMimeTypeFromBase64 } from "./imageSignature.js";
import {
  buildHttpErrorFromResponse,
  classifyNetworkError,
} from "./providerErrors.js";

const DEBUG_REQUEST_LOGS = process.env.GPT_IMAGE_STUDIO_DEBUG_REQUESTS === "1";

/**
 * Provider 调用统一携带的可选项。
 * `signal` 用于客户端取消透传：route 层在浏览器断开时 abort，
 * 该信号一路传到 fetch，让上游请求同步取消、释放连接/凭据。
 */
export type ProviderRequestOptions = {
  signal?: AbortSignal;
};

/**
 * 安全 JSON 解析。空文本或非法 JSON 返回 null，不抛错。
 * 统一了此前各 adapter 的 safeJsonParse / parseJsonResponse（逻辑完全一致）。
 */
export function safeJsonParse(text: string): Record<string, any> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * 从上游错误响应里提取人类可读的错误信息（OpenAI 风格错误解析）。
 *
 * 这是各 adapter 原有 extractErrorMessage / extractDashScopeErrorMessage 的统一超集，
 * 覆盖所有曾经出现过的字段组合：
 *   - DashScope 风格：code + message 拼成 "code: message"（修正了原 dashscope 版第二个 if 永远进不去的 bug）
 *   - 顶层 message（OpenAI / Gemini / Grok）
 *   - error 是 string
 *   - error.message（OpenAI 标准 error 对象）
 *
 * 取到第一个非空值即返回；都没有则返回 null，由调用方决定回退文案。
 */
export function extractErrorMessage(
  payload: Record<string, any> | null,
): string | null {
  if (!payload) return null;
  // DashScope 风格：code + message 组合（放在最前，避免被下面的顶层 message 抢先）
  if (typeof payload.code === "string" && typeof payload.message === "string") {
    return `${payload.code}: ${payload.message}`;
  }
  // 顶层 message
  if (typeof payload.message === "string") return payload.message;
  // OpenAI 标准 error 对象 / error 是 string
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return null;
}

/**
 * 发送 JSON POST 请求。fetch 抛异常时按 errno/cause 分类成 ProviderCallError，
 * 不再用统一文案吞掉原因。
 *
 * 鉴权方式由调用方通过 headers 传入（Bearer 家族传 Authorization，Gemini 传 x-goog-api-key）。
 * Content-Type 固定为 application/json；multipart 请求走 postMultipart。
 *
 * `options.signal` 一路透传给 fetch：浏览器断开时 route 层构造的 AbortSignal 会
 * 让上游请求立即取消，释放凭据/连接。
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: ProviderRequestOptions = {},
): Promise<Response> {
  logSafeProviderRequest(url, body);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw classifyNetworkError(error);
  }
}

/**
 * 发送 multipart/form-data POST 请求（图片编辑路径）。
 *
 * 合并了此前 openai.ts 和 openaiCompatible.ts 里字节级重复的 fetch+try/catch 样板。
 * 调用方负责组装 boundary + body 字节，本函数只负责发送 + 错误分类。
 *
 * body 类型用 `Uint8Array | Buffer`——直接传 Buffer 时 Node fetch 接受，
 * 传 Uint8Array 时调用方负责把它包成 fetch 能识别的 BodyInit 形状（历史代码用 new Uint8Array
 * 是为了在浏览器+Node 之间统一，但本模块只在 Node 运行）。
 *
 * `options.signal` 同样透传给 fetch，与 postJson 行为一致。
 */
export async function postMultipart(
  url: string,
  headers: Record<string, string>,
  body: BodyInit,
  options: ProviderRequestOptions = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw classifyNetworkError(error);
  }
}

/**
 * 调试时只记录真正发给上游的尺寸相关字段，不记录 prompt、API key、图片或 base64。
 * 通过 GPT_IMAGE_STUDIO_DEBUG_REQUESTS=1 显式开启，避免正常运行日志泄露请求细节。
 */
function logSafeProviderRequest(url: string, body: unknown): void {
  if (!DEBUG_REQUEST_LOGS || !body || typeof body !== "object" || Array.isArray(body)) {
    return;
  }

  const record = body as Record<string, unknown>;
  const safe: Record<string, unknown> = { url };
  for (const key of [
    "model",
    "size",
    "width",
    "height",
    "resolution",
    "image_size",
    "aspect_ratio",
    "background",
    "output_format",
    "response_format",
  ]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }

  const imageConfig = (
    (record.generationConfig as Record<string, unknown> | undefined)?.responseFormat as
      | Record<string, unknown>
      | undefined
  )?.image as Record<string, unknown> | undefined;
  if (imageConfig) {
    if (typeof imageConfig.aspectRatio === "string") safe.aspect_ratio = imageConfig.aspectRatio;
    if (typeof imageConfig.imageSize === "string") safe.image_size = imageConfig.imageSize;
  }

  console.info(`[companion debug] provider request ${JSON.stringify(safe)}`);
}

/**
 * 解析 OpenAI Images API 风格的响应，统一输出 { b64Json }。
 *
 * 200 取 data[0].b64_json，非 2xx 抛带上游 error.message 的错。
 * 响应不带 MIME，对 base64 做签名嗅探得到真实格式。
 *
 * 由 OpenAI 兼容家族（openai / grok）共用——两者响应都是标准 data[0].b64_json 形状。
 * GLM 返回 url 而非 b64_json（协议不同），不走这里；Doubao 走自己的内联解析。
 */
export async function parseImagesResponse(
  response: Response,
  providerLabel: string,
): Promise<OpenAIImageResult> {
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = extractErrorMessage(payload);
    throw buildHttpErrorFromResponse(response.status, detail);
  }

  const item = payload?.data?.[0];
  const b64Json = item?.b64_json;
  if (!b64Json) {
    throw new Error(
      extractErrorMessage(payload) ??
        `${providerLabel} 响应中没有 data[0].b64_json。`,
    );
  }
  return {
    b64Json,
    revisedPrompt: item?.revised_prompt,
    mimeType: sniffMimeTypeFromBase64(b64Json) ?? undefined,
  };
}
