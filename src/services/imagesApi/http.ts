import type { ApiMode } from "../../types/studio";
import type { ImageApiResponse } from "./types.js";

/** 把用户配置的 apiBaseUrl 规整成完整的 API 端点前缀。 */
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

export function buildApiEndpoint(
  apiBaseUrl: string,
  apiBaseUrlMode: "origin" | "full",
  apiMode: ApiMode,
  path: string,
) {
  return `${normalizeApiBaseUrl(apiBaseUrl, apiBaseUrlMode, apiMode)}/${path}`;
}

/** 判断响应是否为 SSE 事件流（Content-Type 含 text/event-stream）。 */
export function isEventStreamResponse(response: Response) {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") ?? false;
}

/** 解析 Images API 响应（generations/edits）。 */
export async function parseImageResponse(response: Response) {
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

/** 泛型 JSON 响应解析（Responses API 用）。 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** 从错误响应里提取可读的 HTTP 错误信息。 */
export async function getApiErrorMessage(response: Response) {
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

/**
 * 把流式预览图片数（streamPartialImages）归一化为 0-3 的整数。
 *
 * 各调用路径（Images API generate/edit、Responses API generate/edit）都需要
 * 把用户配置的值钳到 OpenAI 接受的 0-3 范围，历史上有两份逐字重复的实现，
 * 现统一在本模块导出。
 */
export function normalizeStreamPartialImages(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(3, Math.max(0, Math.trunc(numeric))) as 0 | 1 | 2 | 3;
}
