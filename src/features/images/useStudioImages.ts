import { onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { useImagesStore } from "../../stores/imagesStore";
import {
  createImageAssetServices,
  type ImageAssetServices,
} from "../../services/imageAssets";
import { resolveStorage } from "../../services/storage/resolveStorage";
import type { ImageAsset, Message } from "../../types/studio";
import type { Ref } from "vue";

type UseStudioImagesInput = {
  activeConversationId: Ref<string>;
  messages: Ref<Message[]>;
  onStorageError: (error: unknown) => void;
  /** 阶段一 PR2：存储服务注入。可选——未传时用默认实例。PR4 在 ViewModel 统一注入。 */
  services?: {
    imageAssets: ImageAssetServices;
  };
};

// 模块级默认 service 实例，供未显式注入时使用（PR4 后 ViewModel 统一注入）。
const defaultImageAssets = createImageAssetServices(resolveStorage());

export function useStudioImages(input: UseStudioImagesInput) {
  const images = useImagesStore();
  const refs = storeToRefs(images);

  images.configureImagesStore({
    services: {
      imageAssets: input.services?.imageAssets ?? defaultImageAssets,
    },
    activeConversationId: input.activeConversationId,
    messages: input.messages,
    onStorageError: input.onStorageError,
  });

  onUnmounted(() => {
    images.revokePreviewUrls();
  });

  return {
    ...refs,
    attachImage: images.attachImage,
    clearTransientMask: images.clearTransientMask,
    createMaskAsset: images.createMaskAsset,
    deleteImage: images.deleteImage,
    deleteImages: images.deleteImages,
    hydrateImagePreviews: images.hydrateImagePreviews,
    imageById: images.imageById,
    importImages: images.importImages,
    refreshStorageUsage: images.refreshStorageUsage,
    removeAttachment: images.removeAttachment,
    renameImage: images.renameImage,
    setImageTagColor: images.setImageTagColor as (
      id: string,
      nextColor?: ImageAsset["tagColor"],
    ) => Promise<boolean>,
  };
}
