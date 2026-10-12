import { t } from "../i18n";
import type { GenerationParams, ImageAsset, PromptRequestSettings } from "../types/studio";
import { readImageDimensions } from "./imageMetadata";
import { filenameFromAsset } from "./generationLabels";

/**
 * 图像编辑请求的前置解析与校验。
 *
 * 历史上内联在 generationStore.requestImageEdit（约 117 行），把"把图片 ID
 * 解析成 blob + 校验 20MB 上限 / mask PNG / mask 尺寸匹配"与"调用 imageClient.edit"
 * 混在一起。抽出后 store 只负责最后的 edit 调用，本模块负责把 references 解析成
 * 可发送的 EditImageInput（不含 imageClient）。
 */

/** 单张待发送图片（blob + 文件名 + 原 ID）。 */
export type ResolvedEditImage = {
  id: string;
  blob: Blob;
  name: string;
};

/** 编辑请求的解析结果（直接喂给 imageClient.edit 的载荷）。 */
export type ResolvedEditRequest = {
  prompt: string;
  params: GenerationParams;
  promptRequestSettings: PromptRequestSettings;
  images: Array<{ blob: Blob; name: string }>;
  mask?: { blob: Blob; name: string };
};

/** 单张图片总大小上限（20MB，与 OpenAI Images API edits 一致）。 */
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 把 references（图片 ID 列表）解析成可发送的编辑请求载荷。
 *
 * 校验项：
 *   1. 每张引用图都能找到 ImageAsset 且 blob 可读
 *   2. 所有图片总大小 ≤ 20MB
 *   3. 若指定了 editMaskImageId：mask 必须是 PNG、尺寸与源图一致
 *   4. 若指定了 editSourceImageId：源图必须在 references 里
 *
 * 解析失败的错误文案与历史实现完全一致（中文，面向用户）。
 *
 * `resolveBlob` 由调用方注入（store 持有 loadImageBlob），保持本模块不直接依赖 IndexedDB。
 */
export async function resolveImageEditRequest(args: {
  prompt: string;
  references: string[];
  params: GenerationParams;
  promptRequestSettings: PromptRequestSettings;
  editSourceImageId?: string;
  editMaskImageId?: string;
  imageById: (id: string) => ImageAsset | undefined;
  resolveBlob: (image?: ImageAsset) => Promise<Blob | undefined>;
}): Promise<ResolvedEditRequest> {
  const {
    prompt,
    references,
    params,
    promptRequestSettings,
    editSourceImageId,
    editMaskImageId,
    imageById,
    resolveBlob,
  } = args;

  const imageSources = await Promise.all(
    references.map(async (id) => {
      const reference = imageById(id);
      if (!reference) {
        throw new Error(t("generation.editError.referenceMissing"));
      }
      const blob = await resolveBlob(reference);
      if (!blob) {
        throw new Error(t("generation.editError.referenceUnreadable"));
      }

      return {
        id,
        blob,
        name: filenameFromAsset(reference),
      };
    }),
  );

  const totalBytes = imageSources.reduce((sum, img) => sum + img.blob.size, 0);
  if (totalBytes > MAX_PAYLOAD_BYTES) {
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      t("generation.editError.payloadTooLarge", { total: totalMB }),
    );
  }

  const sourceImage = editSourceImageId ? imageById(editSourceImageId) : undefined;
  const maskImage = editMaskImageId ? imageById(editMaskImageId) : undefined;
  let maskBlob: Blob | undefined;
  if (maskImage) {
    maskBlob = await resolveBlob(maskImage);
    if (!maskBlob) {
      throw new Error(t("generation.editError.maskUnreadable"));
    }
    if (maskBlob.type !== "image/png") {
      throw new Error(t("generation.editError.maskNotPng"));
    }
  }

  const editImages = editSourceImageId
    ? imageSources.filter((image) => image.id === editSourceImageId)
    : imageSources;
  if (editSourceImageId && !editImages.length) {
    throw new Error(t("generation.editError.sourceNotInReferences"));
  }
  if (editMaskImageId && !maskImage) {
    throw new Error(t("generation.editError.maskMissing"));
  }
  if (editMaskImageId && !editSourceImageId) {
    throw new Error(t("generation.editError.sourceMissing"));
  }
  if (maskBlob && sourceImage) {
    const sourceBlob = await resolveBlob(sourceImage);
    if (!sourceBlob) {
      throw new Error(t("generation.editError.sourceUnreadable"));
    }
    const [sourceSize, maskSize] = await Promise.all([
      readImageDimensions(sourceBlob),
      readImageDimensions(maskBlob),
    ]);
    if (
      sourceSize &&
      maskSize &&
      (sourceSize.width !== maskSize.width ||
        sourceSize.height !== maskSize.height)
    ) {
      throw new Error(t("generation.editError.maskSizeMismatch"));
    }
  }

  if (maskBlob) {
    console.info(
      "[generation] edit with mask",
      JSON.stringify({
        prompt: prompt.slice(0, 80),
        sourceImageId: editSourceImageId,
        maskImageId: editMaskImageId,
        referenceCount: references.length,
        sentImageCount: (editImages.length ? editImages : imageSources).length,
      }),
    );
  }

  const sentImages = (editImages.length ? editImages : imageSources).map((item) => ({
    blob: item.blob,
    name: item.name,
  }));

  return {
    prompt,
    params,
    promptRequestSettings,
    images: sentImages,
    mask: maskBlob ? { blob: maskBlob, name: "mask.png" } : undefined,
  };
}
