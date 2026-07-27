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
        throw new Error("引用图片不存在，请重新添加引用。");
      }
      const blob = await resolveBlob(reference);
      if (!blob) {
        throw new Error("无法读取引用图片文件，请重新生成或导入图片。");
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
      `引用图片总大小为 ${totalMB}MB，超过 20MB 上限。请减少图片数量或压缩图片后重试。`,
    );
  }

  const sourceImage = editSourceImageId ? imageById(editSourceImageId) : undefined;
  const maskImage = editMaskImageId ? imageById(editMaskImageId) : undefined;
  let maskBlob: Blob | undefined;
  if (maskImage) {
    maskBlob = await resolveBlob(maskImage);
    if (!maskBlob) {
      throw new Error("无法读取编辑遮罩文件，请重新选择编辑区域。");
    }
    if (maskBlob.type !== "image/png") {
      throw new Error("编辑遮罩必须是 PNG 文件，请重新选择编辑区域。");
    }
  }

  const editImages = editSourceImageId
    ? imageSources.filter((image) => image.id === editSourceImageId)
    : imageSources;
  if (editSourceImageId && !editImages.length) {
    throw new Error("编辑源图不在当前引用列表中，请重新选择继续编辑。");
  }
  if (editMaskImageId && !maskImage) {
    throw new Error("编辑遮罩不存在，请重新选择编辑区域。");
  }
  if (editMaskImageId && !editSourceImageId) {
    throw new Error("缺少编辑源图，无法使用局部编辑。");
  }
  if (maskBlob && sourceImage) {
    const sourceBlob = await resolveBlob(sourceImage);
    if (!sourceBlob) {
      throw new Error("无法读取编辑源图，请重新引用图片。");
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
      throw new Error("编辑遮罩尺寸与源图不一致，请重新选择编辑区域。");
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
