import type { ImageAsset } from "../types/studio";

export const BYTE_KB = 1024;
export const BYTE_MB = 1024 * 1024;
export const BYTE_GB = 1024 * 1024 * 1024;

/**
 * 将字节数格式化为人类可读的文件大小字符串。
 *
 * 与历史实现保持一致的规则：
 * - 字节数为 0 或 falsy 时返回 "未知大小"
 * - < 1 MB 时显示 KB（向上取整，至少 1）
 * - < 1 GB 时显示 MB（1 位小数）
 * - ≥ 1 GB 时显示 GB（2 位小数）
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes) return "未知大小";
  if (bytes < BYTE_MB) {
    return `${Math.max(1, Math.round(bytes / BYTE_KB))} KB`;
  }
  if (bytes < BYTE_GB) {
    return `${(bytes / BYTE_MB).toFixed(1)} MB`;
  }
  return `${(bytes / BYTE_GB).toFixed(2)} GB`;
}

/**
 * 紧凑版字节格式化，用于附件摘要等空间受限的 UI。
 * - 没有 "未知大小" 兜底（0 B 起步）
 * - 不显示 GB（理论上附件不会超过 GB）
 * - 单位紧跟数字（"1.2MB" 而非 "1.2 MB"）
 */
export function formatFileSizeCompact(bytes?: number): string {
  if (!bytes || bytes < 0) return "0B";
  if (bytes < BYTE_KB) return `${bytes}B`;
  if (bytes < BYTE_MB) return `${(bytes / BYTE_KB).toFixed(1)}KB`;
  return `${(bytes / BYTE_MB).toFixed(1)}MB`;
}

/** 从 image mimeType 推导扩展名（不含点）。未知时回退 "png"。 */
export function imageExtension(mimeType?: string): "jpeg" | "webp" | "png" {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/** 由 ImageAsset 派生下载文件名（`<name>.<ext>`）。 */
export function imageDownloadName(image: ImageAsset): string {
  return `${image.name || "image"}.${imageExtension(image.mimeType)}`;
}
