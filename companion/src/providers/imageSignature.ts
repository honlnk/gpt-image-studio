/**
 * 图片 magic bytes 嗅探。
 *
 * 把原本散落在 urlToB64.ts 内部的签名检测函数提取成共享工具，供两类场景复用：
 *   1. urlToB64 下载路径：校验 Content-Type 与真实字节是否一致（安全边界）。
 *   2. openai/doubao/grok 等「厂商响应不带 MIME」的 adapter：对 base64 嗅探出真实格式，
 *      透传给 Web，避免 ImageAsset.mimeType 与字节不符。
 */

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** 嗅探 magic bytes 所需的最小字节数（WebP 的 RIFF....WEBP 占 12 字节）。 */
const MIN_SNIFF_BYTES = 12;

export function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

export function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

export function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= MIN_SNIFF_BYTES &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

/**
 * 按 magic bytes 判定 buffer 的真实图片 MIME。
 * 仅识别 PNG / JPEG / WebP，与 Companion 接受的图片类型范围一致。
 * 无法识别时返回 null（调用方自行决定回退策略）。
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (isPng(buffer)) return "image/png";
  if (isJpeg(buffer)) return "image/jpeg";
  if (isWebp(buffer)) return "image/webp";
  return null;
}

/**
 * 校验 buffer 与声明的 MIME 是否一致（urlToB64 下载路径用）。
 * 不一致抛错——这是 SSRF / 内容伪装的安全边界。
 */
export function assertSignatureMatches(
  buffer: Buffer,
  mimeType: string,
): void {
  const valid =
    (mimeType === "image/png" && isPng(buffer)) ||
    (mimeType === "image/jpeg" && isJpeg(buffer)) ||
    (mimeType === "image/webp" && isWebp(buffer));

  if (!valid) {
    throw new Error(`图片内容与 Content-Type ${mimeType} 不匹配。`);
  }
}

/**
 * 对 base64 字符串嗅探真实图片 MIME。
 *
 * 只解码足够判定签名的前缀（16 个 base64 字符 → 12 字节），避免对大图整段解码。
 * 用于厂商响应不带 MIME 的 adapter（openai/doubao/grok）——这些 adapter 已经持有
 * 完整 base64，但只需前缀即可判定格式。
 *
 * 返回 null 表示无法识别（调用方回退到 outputFormat 猜测）。
 */
export function sniffMimeTypeFromBase64(base64: string): string | null {
  if (!base64) return null;
  // base64 每 4 字符解码 3 字节；取前 16 字符得 12 字节，覆盖所有需要的签名长度。
  const prefix = base64.slice(0, 16);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(prefix, "base64");
  } catch {
    return null;
  }
  return sniffImageMimeType(buffer);
}
