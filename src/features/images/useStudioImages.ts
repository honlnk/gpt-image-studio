import { onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { useImagesStore } from "../../stores/imagesStore";
import type { ImageAsset, Message } from "../../types/studio";
import type { Ref } from "vue";

type UseStudioImagesInput = {
  activeConversationId: Ref<string>;
  messages: Ref<Message[]>;
  onStorageError: (error: unknown) => void;
};

export function useStudioImages(input: UseStudioImagesInput) {
  const images = useImagesStore();
  const refs = storeToRefs(images);

  images.configureImagesStore(input);

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
