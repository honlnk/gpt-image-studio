/**
 * 所有 provider adapter 共用的 HTTP/解析工具。
 *
 * 这里集中了此前散落在 7 个 adapter 里的 4 类真重复：
 *   1. UPSTREAM_DISCONNECT_MESSAGE —— 逐字相同的上游断开文案
 *   2. safeJsonParse —— try { JSON.parse } catch { null }
 *   3. extractErrorMessage —— OpenAI 风格错误信息提取（统一超集）
 *   4. postJson —— fetch + try/catch 断开处理的样板
 *
 * 不放这里的内容（各 adapter 的独有算法）：
 *   - normalize*Size 尺寸规整（边界条件各异，不可合并）
 *   - buildBody / parseResponse（协议形状不同）
 *   - DEFAULT_*_BASE_URL / DEFAULT_*_MODEL（连接信息，归 providerPresets.ts）
 *
 * parseImagesResponse 是例外——它解析的是 OpenAI Images API 标准响应形状
 * data[0].b64_json，属于"协议标准"而非"provider 差异"，因此与 HTTP 工具放一起，
 * 由 OpenAI 兼容家族（openai / grok）共用。
 */

import type { OpenAIImageResult } from "./types.js";
import { sniffMimeTypeFromBase64 } from "./imageSignature.js";

const DEBUG_REQUEST_LOGS = process.env.GPT_IMAGE_STUDIO_DEBUG_REQUESTS === "1";

/** 上游连接被主动断开（fetch 抛异常）时的统一文案。 */
export const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

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
 * 发送 JSON POST 请求，fetch 抛异常时统一转成 UPSTREAM_DISCONNECT_MESSAGE。
 *
 * 统一了此前 11 处 `fetch + Bearer + try/catch` 样板。
 * 鉴权方式由调用方通过 headers 传入（Bearer 家族传 Authorization，Gemini 传 x-goog-api-key）。
 * Content-Type 固定为 application/json；multipart 请求不走这里。
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  logSafeProviderRequest(url, body);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
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
    throw new Error(detail ?? `请求失败：HTTP ${response.status}`);
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
