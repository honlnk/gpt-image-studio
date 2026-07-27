import type { ImageAsset } from "../../types/studio";
import {
  formatFileSize,
  imageDownloadName as sharedImageDownloadName,
  imageExtension as sharedImageExtension,
} from "../../shared/fileFormatters";

export function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

export function imageFormat(image: ImageAsset) {
  return image.mimeType?.replace("image/", "").toUpperCase() ?? "未知";
}

export function imageExtension(image: ImageAsset) {
  return sharedImageExtension(image.mimeType);
}

export function imageDownloadName(image: ImageAsset) {
  return sharedImageDownloadName(image);
}

export function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return "未记录";
}

export function fileSize(image: ImageAsset) {
  return formatFileSize(image.sizeBytes);
}
