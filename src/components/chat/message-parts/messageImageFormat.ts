import type { ImageAsset, Message } from "../../../types/studio";

export function imageExtension(image?: ImageAsset) {
  if (image?.mimeType === "image/jpeg") return "jpeg";
  if (image?.mimeType === "image/webp") return "webp";
  return "png";
}

export function imageDownloadName(image?: ImageAsset) {
  return `${image?.name || "image"}.${imageExtension(image)}`;
}

export function durationLabel(milliseconds?: number) {
  if (milliseconds === undefined) return "耗时未知";
  if (milliseconds < 1000) return `${milliseconds}ms`;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function messageErrorText(message: Message) {
  return message.errorMessage || "请重试这个图片卡片。";
}
