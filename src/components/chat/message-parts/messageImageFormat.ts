import type { ImageAsset, Message } from "../../../types/studio";
import { imageExtension as imageExtensionFromMime } from "../../../shared/fileFormatters";

/**
 * 从 ImageAsset 推导扩展名（不含点）。
 *
 * 与 shared/fileFormatters.imageExtension 的关系：
 * - shared 版接受 `mimeType?: string`（纯字符串工具，无 ImageAsset 依赖）
 * - 本地版接受 `image?: ImageAsset`（消息卡片场景 image 可能为 undefined）
 *
 * 签名不同故保留本地包装，内部委托 shared 版，避免 MIME→扩展名映射出现两个真相源。
 */
export function imageExtension(image?: ImageAsset) {
  return imageExtensionFromMime(image?.mimeType);
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
