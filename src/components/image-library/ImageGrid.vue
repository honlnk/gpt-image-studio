<script setup lang="ts">
import type { ImageAsset } from "../../types/studio";
import ImageCard from "./ImageCard.vue";

defineProps<{
  activeFilter: "current" | "all";
  attachedImageIds: string[];
  images: ImageAsset[];
  selectedImageId: string;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  previewImage: [id: string];
  selectImage: [id: string];
}>();

function isAttached(imageId: string, attachedImageIds: string[]) {
  return attachedImageIds.includes(imageId);
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-3">
    <div
      v-if="!images.length"
      class="flex h-full min-h-55 items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 text-center text-sm text-gray-400"
    >
      {{ activeFilter === "current" ? "当前会话还没有图片" : "图片库还是空的" }}
    </div>

    <ImageCard
      v-for="image in images"
      :key="image.id"
      :image="image"
      :is-attached="isAttached(image.id, attachedImageIds)"
      :is-selected="selectedImageId === image.id"
      @attach-image="emit('attachImage', $event)"
      @preview-image="emit('previewImage', $event)"
      @select-image="emit('selectImage', $event)"
    />
  </div>
</template>
