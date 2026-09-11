/**
 * 浏览器直连模式：下载服务商返回的图片 URL，并转成 base64 结果。
 *
 * 部分中转/厂商无视 response_format=b64_json，只返回有时效的图片链接
 * （data[0].url，或 Responses API 里被换成链接的 result）。Companion 模式
 * 在服务端下载（urlToB64，带出网地址策略）；本模块是直连模式在浏览器内的
 * 对应实现——能否成功取决于对方 CDN 的 CORS 策略，失败时抛带行动建议的错误。
 *
 * 安全边界（与 Companion 对齐）：
 * - 仅接受 http/https 链接；
 * - 响应体流式读取，超过大小上限立即中止；
 * - 用 magic bytes 嗅探真实格式（PNG/JPEG/WebP），嗅探不出图片签名一律拒绝，
 *   防止把 HTML/脚本等内容当图片存入库。
 */

/** 直连模式解析/下载失败时的统一行动建议。 */
export const DIRECT_MODE_FALLBACK_HINT =
  "建议切换到 Companion 模式（服务端下载图片，不受浏览器跨域限制），或直接下载桌面应用。";

/** 单张图片允许下载的最大字节数（与 Companion urlToB64 的上限一致）。 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** 下载链接图片的结果：base64（不含 data: 前缀）+ 嗅探出的真实 MIME。 */
export type DownloadedImage = {
  b64Json: string;
  mimeType: string;
};

export async function downloadImageUrlAsBase64(
  url: string,
): Promise<DownloadedImage> {
  const target = parseImageUrl(url);

  let response: Response;
  try {
    response = await fetch(target.href, {
      headers: { Accept: "image/png,image/jpeg,image/webp" },
    });
  } catch (error) {
    throw new Error(
      `下载图片链接失败（可能是浏览器跨域限制）：${errorMessage(error)}。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `下载图片链接失败：HTTP ${response.status}。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  const bytes = await readBoundedBody(response);
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) {
    throw new Error(
      `下载的链接内容不是有效的 PNG/JPEG/WebP 图片。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  return { b64Json: bytesToBase64(bytes), mimeType };
}

function parseImageUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `服务商返回的图片链接格式无效。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `服务商返回的图片链接协议不受支持（仅允许 http/https）。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  return parsed;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("Content-Length"));
  if (
    Number.isSafeInteger(contentLength) &&
    contentLength > MAX_IMAGE_BYTES
  ) {
    throw new Error(
      `图片响应超过大小上限 ${Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024))} MiB。${DIRECT_MODE_FALLBACK_HINT}`,
    );
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `图片响应超过大小上限 ${Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024))} MiB。${DIRECT_MODE_FALLBACK_HINT}`,
      );
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(
        `图片响应超过大小上限 ${Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024))} MiB。${DIRECT_MODE_FALLBACK_HINT}`,
      );
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  return null;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    asciiSlice(bytes, 0, 4) === "RIFF" &&
    asciiSlice(bytes, 8, 12) === "WEBP"
  );
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // 32 KiB 一段拼接，避免单次 String.fromCharCode 参数过长。
  const CHUNK_SIZE = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return btoa(binary);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
