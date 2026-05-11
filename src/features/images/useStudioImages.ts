import { computed, onUnmounted, ref, watch } from "vue";
import {
  deleteImageAsset,
  deleteImageBlob,
  loadImageBlob,
  saveImageAsset,
  saveImageBlob,
} from "../../services/imageAssets";
import { isoTimestamp } from "../../shared/dateTime";
import { formatError } from "../../shared/errors";
import { createId } from "../../shared/id";
import { readImageDimensions } from "../../services/imageMetadata";
import { createObjectUrl, revokeObjectUrls } from "../../shared/objectUrls";
import { estimateStorageUsage } from "../../services/storageUsage";
import type { ImageAsset, Message } from "../../types/studio";
import type { StorageUsage } from "../../services/storageUsage";
import type { StudioConfirmDialog } from "../feedback";
import type { Ref } from "vue";

type UseStudioImagesInput = {
  activeConversationId: Ref<string>;
  messages: Ref<Message[]>;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  onStorageError: (error: unknown) => void;
  requestConfirmation: (input: StudioConfirmDialog) => Promise<boolean>;
};

export function useStudioImages(input: UseStudioImagesInput) {
  const attachedImages = ref<string[]>([]);
  const imageAssets = ref<ImageAsset[]>([]);
  const storageUsage = ref<StorageUsage | null>(null);

  const activeAttachments = computed(() =>
    attachedImages.value
      .map((id) => imageAssets.value.find((image) => image.id === id))
      .filter((image): image is ImageAsset => Boolean(image)),
  );

  watch(
    imageAssets,
    (nextImages, previousImages) => {
      revokeRemovedPreviewUrls(previousImages, nextImages);
    },
    { flush: "post" },
  );

  onUnmounted(() => {
    revokeObjectUrls(imageAssets.value.map((image) => image.previewUrl));
  });

  function imageById(id: string) {
    return imageAssets.value.find((image) => image.id === id);
  }

  function attachImage(id: string) {
    if (!attachedImages.value.includes(id)) {
      attachedImages.value.push(id);
    }
  }

  function removeAttachment(id: string) {
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
  }

  async function deleteImage(id: string) {
    const image = imageById(id);
    if (!image) return;

    const relatedMessages = input.messages.value.filter(
      (message) =>
        message.referencedImageIds.includes(id) ||
        message.resultImageIds.includes(id),
    );
    const isAttached = attachedImages.value.includes(id);

    const confirmMessage = relatedMessages.length || isAttached
      ? "这张图片正在被聊天记录或当前输入引用，删除后聊天记录中会保留无法显示的占位。确定删除吗？"
      : "确定从图片库中删除这张图片吗？";
    const confirmed = await input.requestConfirmation({
      title: "删除图片",
      description: confirmMessage,
      confirmLabel: "删除图片",
      tone: "danger",
    });
    if (!confirmed) return;

    attachedImages.value = attachedImages.value.filter((item) => item !== id);
    imageAssets.value = imageAssets.value.filter((item) => item.id !== id);

    try {
      await Promise.all([
        deleteImageAsset(id),
        image.blobKey ? deleteImageBlob(image.blobKey) : Promise.resolve(),
      ]);
      await refreshStorageUsage();
      input.notifySuccess("图片已删除。");
    } catch (error) {
      input.notifyError(`删除图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function deleteImages(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;

    const deletedImages = imageAssets.value.filter((image) =>
      idSet.has(image.id),
    );
    attachedImages.value = attachedImages.value.filter((id) => !idSet.has(id));
    imageAssets.value = imageAssets.value.filter((image) => !idSet.has(image.id));

    try {
      await Promise.all(
        deletedImages.flatMap((image) => [
          deleteImageAsset(image.id),
          image.blobKey ? deleteImageBlob(image.blobKey) : Promise.resolve(),
        ]),
      );
      await refreshStorageUsage();
      input.notifySuccess(`已删除 ${deletedImages.length} 张图片。`);
    } catch (error) {
      input.notifyError(`删除图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function importImages(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    try {
      const importedAssets = await Promise.all(
        imageFiles.map((file) => importImageFile(file)),
      );

      imageAssets.value = [...importedAssets, ...imageAssets.value];
      importedAssets.forEach((asset) => attachImage(asset.id));
      await refreshStorageUsage();
      input.notifySuccess(`已导入 ${importedAssets.length} 张图片并加入引用。`);
    } catch (error) {
      input.notifyError(`导入图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function importImageFile(file: File) {
    const now = Date.now() + Math.floor(Math.random() * 1000);
    const createdAt = isoTimestamp(now);
    const dimensions = await readImageDimensions(file);
    const imageId = createId("img");
    const blobKey = createId("blob");
    const imageAsset: ImageAsset = {
      id: imageId,
      blobKey,
      name: file.name || `导入图片-${now}`,
      source: "imported",
      mimeType: file.type || "image/png",
      width: dimensions?.width,
      height: dimensions?.height,
      sizeBytes: file.size,
      conversationId: input.activeConversationId.value || undefined,
      prompt: "用户导入的参考图",
      createdAt,
      updatedAt: createdAt,
      previewUrl: createObjectUrl(file),
    };

    await Promise.all([
      saveImageBlob(blobKey, file),
      saveImageAsset(toPlainImageAsset(imageAsset)),
    ]).catch(input.onStorageError);

    return imageAsset;
  }

  async function createMaskAsset(sourceImage: ImageAsset, maskBlob: Blob) {
    const now = Date.now();
    const createdAt = isoTimestamp(now);
    const imageId = createId("img");
    const blobKey = createId("blob");
    const maskAsset: ImageAsset = {
      id: imageId,
      blobKey,
      name: `${sourceImage.name}-编辑区域`,
      source: "generated",
      mimeType: "image/png",
      width: sourceImage.width,
      height: sourceImage.height,
      sizeBytes: maskBlob.size,
      conversationId: input.activeConversationId.value || undefined,
      prompt: "局部编辑遮罩",
      editSourceImageId: sourceImage.id,
      isEditMask: true,
      createdAt,
      updatedAt: createdAt,
      previewUrl: createObjectUrl(maskBlob),
    };

    await Promise.all([
      saveImageBlob(blobKey, maskBlob),
      saveImageAsset(toPlainImageAsset(maskAsset)),
    ]).catch(input.onStorageError);

    imageAssets.value = [maskAsset, ...imageAssets.value];
    return maskAsset;
  }

  async function hydrateImagePreviews(assets: ImageAsset[]) {
    return Promise.all(
      assets.map(async (asset) => {
        if (!asset.blobKey) return asset;

        const blob = await loadImageBlob(asset.blobKey);
        if (!blob) return asset;

        const restoredAsset = {
          ...asset,
          previewUrl: createObjectUrl(blob),
        };

        if (restoredAsset.width && restoredAsset.height) {
          return restoredAsset;
        }

        const dimensions = await readImageDimensions(blob);
        if (!dimensions) return restoredAsset;

        const updatedAsset = {
          ...restoredAsset,
          width: dimensions.width,
          height: dimensions.height,
        };
        await saveImageAsset(toPlainImageAsset(updatedAsset)).catch(input.onStorageError);
        return updatedAsset;
      }),
    );
  }

  async function refreshStorageUsage() {
    storageUsage.value = await estimateStorageUsage().catch((error) => {
      input.onStorageError(error);
      return storageUsage.value;
    });
  }

  return {
    activeAttachments,
    attachImage,
    attachedImages,
    deleteImage,
    deleteImages,
    hydrateImagePreviews,
    imageAssets,
    imageById,
    createMaskAsset,
    importImages,
    refreshStorageUsage,
    removeAttachment,
    storageUsage,
  };
}

function toPlainImageAsset(imageAsset: ImageAsset): ImageAsset {
  return {
    id: imageAsset.id,
    blobKey: imageAsset.blobKey,
    name: imageAsset.name,
    source: imageAsset.source,
    mimeType: imageAsset.mimeType,
    width: imageAsset.width,
    height: imageAsset.height,
    sizeBytes: imageAsset.sizeBytes,
    conversationId: imageAsset.conversationId,
    messageId: imageAsset.messageId,
    prompt: imageAsset.prompt,
    referencedImageIds: imageAsset.referencedImageIds
      ? [...imageAsset.referencedImageIds]
      : undefined,
    editSourceImageId: imageAsset.editSourceImageId,
    isEditMask: imageAsset.isEditMask,
    createdAt: imageAsset.createdAt,
    updatedAt: imageAsset.updatedAt,
  };
}

function revokeRemovedPreviewUrls(
  previousImages: ImageAsset[] | undefined,
  nextImages: ImageAsset[],
) {
  if (!previousImages?.length) return;

  const nextPreviewUrls = new Set(
    nextImages
      .map((image) => image.previewUrl)
      .filter((url): url is string => Boolean(url)),
  );
  revokeObjectUrls(
    previousImages
      .map((image) => image.previewUrl)
      .filter((url) => url && !nextPreviewUrls.has(url)),
  );
}
