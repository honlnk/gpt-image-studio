import type { ImageAsset, GenerationParams } from "../types/studio";
import { imageExtension } from "../shared/fileFormatters";

/**
 * 生成相关的纯文案 / 文件名 helper。
 *
 * 历史上内联在 generationStore.ts，但它们与 store 状态无关，是纯函数。
 * 抽出后 store 只负责状态机，文案计算走本模块。
 */

/** 从提示词派生会话标题（截断到 16 字 + 省略号）。 */
export function titleFromPrompt(prompt: string) {
  return prompt.length > 16 ? `${prompt.slice(0, 16)}...` : prompt;
}

/**
 * 从 ImageAsset 派生持久化用文件名（`<name|id>.<ext>`）。
 *
 * 与 shared/fileFormatters.imageDownloadName 的差异：
 * - 这里兜底用 asset.id（持久化场景必须唯一）
 * - imageDownloadName 兜底用 "image"（UI 下载场景用户可读）
 */
export function filenameFromAsset(asset: ImageAsset) {
  return `${asset.name || asset.id}.${imageExtension(asset.mimeType)}`;
}

/** 把 outputFormat（png/jpeg/webp）转成 MIME 类型。 */
export function outputFormatToMimeType(outputFormat: GenerationParams["outputFormat"]) {
  return outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
}

/** 生成完成后的结果计数文案（"已生成 N 张图片。"）。 */
export function resultCountLabel(prefix: string, count: number) {
  return count > 1 ? `${prefix} ${count} 张图片。` : `${prefix}一张图片。`;
}

/** 任务进行中的文案（区分生成 vs 编辑 + 单张 vs 多张）。 */
export function pendingGenerationLabel(isEdit: boolean, count: number) {
  if (isEdit) {
    return count > 1
      ? `正在基于引用图片生成 ${count} 张编辑结果。`
      : "正在基于引用图片生成编辑结果。";
  }

  return count > 1 ? `正在生成 ${count} 张图片。` : "正在生成图片。";
}

/** "继续生成 / 重新生成"场景的文案。 */
export function continuedGenerationLabel(
  isEdit: boolean,
  isReplacing: boolean,
  count: number,
) {
  if (isEdit) {
    if (isReplacing) return "正在重新生成编辑结果。";
    return count > 1
      ? `正在继续生成 ${count} 张编辑结果。`
      : "正在继续生成编辑结果。";
  }

  if (isReplacing) return "正在重新生成图片。";
  return count > 1 ? `正在继续生成 ${count} 张图片。` : "正在继续生成图片。";
}

/** 部分 job 完成时的混合文案（"已生成 N 张，还有 M 张正在生成。"）。 */
export function pendingResultLabel(
  isEdit: boolean,
  generatedCount: number,
  pendingCount: number,
) {
  const generatedPart =
    generatedCount > 0 ? `已生成 ${generatedCount} 张，` : "";
  const noun = isEdit ? "编辑结果" : "图片";
  return `${generatedPart}还有 ${pendingCount} 张${noun}正在生成。`;
}
