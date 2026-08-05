<script setup lang="ts">
import { useNow } from "../../composables/useNow";
import type { ImageAsset } from "../../types/studio";
import ImageCard from "./ImageCard.vue";

defineProps<{
  activeFilter: "current" | "all";
  attachedImageIds: string[];
  images: ImageAsset[];
  selectedImageId: string;
  /** 下一页正在加载中（底部指示，server 模式分页 PR-d）。 */
  loadingMore?: boolean;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  loadMore: [];
  previewImage: [id: string];
  selectImage: [id: string];
}>();

const now = useNow();

// 滚到底通知父级加载下一页（store 内部有游标/在飞守卫，这里只按阈值节流）
function onScroll(event: Event) {
  const el = event.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
    emit("loadMore");
  }
}

function isAttached(imageId: string, attachedImageIds: string[]) {
  return attachedImageIds.includes(imageId);
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-3" @scroll="onScroll">
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
      :now-ms="now"
      @attach-image="emit('attachImage', $event)"
      @preview-image="emit('previewImage', $event)"
      @select-image="emit('selectImage', $event)"
    />
    <div
      v-if="loadingMore"
      class="py-2 text-center text-xs text-gray-400"
    >
      加载更多图片…
    </div>
  </div>
</template>
