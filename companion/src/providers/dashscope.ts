/**
 * DashScope multimodal-generation helpers shared by Alibaba-family providers
 * such as Qwen-Image and Wan.
 *
 * 通用工具（safeJsonParse / extractErrorMessage）复用 providerHttp.ts，
 * 这里只保留 DashScope 形状特有的 output.choices[].message.content[].image 提取逻辑。
 */

import { extractErrorMessage, safeJsonParse } from "./providerHttp.js";
import { buildHttpErrorFromResponse } from "./providerErrors.js";

export type DashScopeContentItem = {
  text?: string;
  image?: string;
};

export type DashScopePayload = Record<string, any>;

export function buildDashScopeGenerationUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return base.endsWith("/generation") ? base : `${base}/generation`;
}

export function dataUrlFromImage(image: { blob: Buffer; mimeType: string }): string {
  return `data:${image.mimeType};base64,${image.blob.toString("base64")}`;
}

export async function parseDashScopeResponse(
  response: Response,
  missingImageMessage: string,
): Promise<string> {
  const text = await response.text();
  const payload = safeJsonParse(text);

  if (!response.ok) {
    const detail = extractErrorMessage(payload);
    throw buildHttpErrorFromResponse(response.status, detail);
  }

  const imageUrl = extractDashScopeImageUrl(payload);
  if (!imageUrl) {
    throw new Error(extractErrorMessage(payload) ?? missingImageMessage);
  }
  return imageUrl;
}

export function extractDashScopeImageUrl(payload: DashScopePayload | null): string | null {
  const content = payload?.output?.choices?.[0]?.message?.content;
  if (!Array.isArray(content)) return null;

  for (const item of content) {
    if (item && typeof item.image === "string" && item.image) {
      return item.image;
    }
  }
  return null;
}
