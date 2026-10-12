import { t } from "../i18n";
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
  return count > 1
    ? t("generation.result.countPlural", { prefix, count })
    : t("generation.result.countSingular", { prefix });
}

/** 任务进行中的文案（区分生成 vs 编辑 + 单张 vs 多张）。 */
export function pendingGenerationLabel(isEdit: boolean, count: number) {
  if (isEdit) {
    return count > 1
      ? t("generation.pending.editPlural", { count })
      : t("generation.pending.editSingular");
  }

  return count > 1
    ? t("generation.pending.textPlural", { count })
    : t("generation.pending.textSingular");
}

/** "继续生成 / 重新生成"场景的文案。 */
export function continuedGenerationLabel(
  isEdit: boolean,
  isReplacing: boolean,
  count: number,
) {
  if (isEdit) {
    if (isReplacing) return t("generation.regenerating.editResult");
    return count > 1
      ? t("generation.continued.editPlural", { count })
      : t("generation.continued.editSingular");
  }

  if (isReplacing) return t("generation.regenerating.image");
  return count > 1
    ? t("generation.continued.textPlural", { count })
    : t("generation.continued.textSingular");
}

/** 部分 job 完成时的混合文案（"已生成 N 张，还有 M 张正在生成。"）。 */
export function pendingResultLabel(
  isEdit: boolean,
  generatedCount: number,
  pendingCount: number,
) {
  const generatedPart =
    generatedCount > 0
      ? t("generation.pendingResult.generatedPart", { count: generatedCount })
      : "";
  const noun = isEdit
    ? t("generation.pendingResult.nounEditResult", pendingCount)
    : t("generation.pendingResult.nounImage", pendingCount);
  return `${generatedPart}${t("generation.pendingResult.remaining", {
    count: pendingCount,
    noun,
  })}`;
}
