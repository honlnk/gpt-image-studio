/**
 * DashScope multimodal-generation helpers shared by Alibaba-family providers
 * such as Qwen-Image and Wan.
 */

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
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail = extractDashScopeErrorMessage(payload);
    throw new Error(detail ?? `请求失败：HTTP ${response.status}`);
  }

  const imageUrl = extractDashScopeImageUrl(payload);
  if (!imageUrl) {
    throw new Error(extractDashScopeErrorMessage(payload) ?? missingImageMessage);
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

export function extractDashScopeErrorMessage(payload: DashScopePayload | null): string | null {
  if (!payload) return null;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.code === "string" && typeof payload.message === "string") {
    return `${payload.code}: ${payload.message}`;
  }
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return null;
}

function safeJsonParse(text: string): DashScopePayload | null {
  try {
    return JSON.parse(text) as DashScopePayload;
  } catch {
    return null;
  }
}
