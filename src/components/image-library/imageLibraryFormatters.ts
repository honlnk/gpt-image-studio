import type { ImageAsset } from "../../types/studio";

export function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

export function imageFormat(image: ImageAsset) {
  return image.mimeType?.replace("image/", "").toUpperCase() ?? "未知";
}

export function imageExtension(image: ImageAsset) {
  if (image.mimeType === "image/jpeg") return "jpeg";
  if (image.mimeType === "image/webp") return "webp";
  return "png";
}

export function imageDownloadName(image: ImageAsset) {
  return `${image.name || "image"}.${imageExtension(image)}`;
}

export function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return "未记录";
}

export function fileSize(image: ImageAsset) {
  if (!image.sizeBytes) return "未知大小";
  if (image.sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(image.sizeBytes / 1024))} KB`;
  }

  return `${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
