/**
 * Blob 与 base64 / data URL 之间的互转工具。
 *
 * 历史上这些函数曾内联在 `services/imagesApi.ts`，调用方却要从
 * "图片 API 客户端"里 import 一个通用工具，分层倒置。
 * 这里集中管理，让 `imagesApi`、`backups`、`zipArchive` 走同一套实现。
 */

/** base64 字符串（不含 data: 前缀）转 Blob。 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * Blob 转 data URL（`data:<mime>;base64,<...>`）。
 *
 * 用于需要把图片直接塞进 JSON 请求体的场景（如 Responses API）。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
