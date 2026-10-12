import { t } from "../../i18n";
import type { ImageAsset } from "../../types/studio";
import {
  formatFileSize,
  imageDownloadName as sharedImageDownloadName,
  imageExtension as sharedImageExtension,
} from "../../shared/fileFormatters";

/** 图片来源分类：在三态细分（生成/编辑/导入）下用于筛选与展示。 */
export type ImageSourceClass = "generated" | "edited" | "imported";

/**
 * 来源分类 → i18n key 映射（值是词条 key，渲染处用 t() 取文案；
 * 非渲染逻辑只依赖 key 集合，保持常量结构稳定）。
 */
export const SOURCE_CLASS_LABELS: Record<ImageSourceClass, string> = {
  generated: "library.shell.sourceGenerated",
  edited: "library.shell.sourceEdited",
  imported: "library.shell.sourceImported",
};

/**
 * 把 ImageAsset 归入三态来源分类。`source === "imported"` 直接判导入；
 * 生成的图若带 editSourceImageId 或 referencedImageIds 视为编辑图，否则纯生成图。
 * 用于图片库筛选与展示。
 */
export function classifyImageSource(image: ImageAsset): ImageSourceClass {
  if (image.source === "imported") return "imported";
  if (image.editSourceImageId || (image.referencedImageIds?.length ?? 0) > 0) {
    return "edited";
  }
  return "generated";
}

export function sourceLabel(image: ImageAsset) {
  return t(SOURCE_CLASS_LABELS[classifyImageSource(image)]);
}

export function imageFormat(image: ImageAsset) {
  return image.mimeType?.replace("image/", "").toUpperCase() ?? t("library.formatters.unknown");
}

export function imageExtension(image: ImageAsset) {
  return sharedImageExtension(image.mimeType);
}

export function imageDownloadName(image: ImageAsset) {
  return sharedImageDownloadName(image);
}

export function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return t("library.formatters.notRecorded");
}

export function fileSize(image: ImageAsset) {
  return formatFileSize(image.sizeBytes);
}
