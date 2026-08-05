<script setup lang="ts">
import { ref, toRef } from "vue";
import { useNow } from "../../composables/useNow";
import { useVirtualList } from "../../composables/useVirtualList";
import type { ImageAsset } from "../../types/studio";
import ImageCard from "./ImageCard.vue";

const props = defineProps<{
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

// 虚拟滚动容器 ref（PR-e：图片库固定高度窗口化，仅渲染可见区 + overscan）。
// toRef 把 props.images 转成 ref，保持 items 变化时区间重算。
// 空状态不走虚拟化，保持原样居中提示。
const containerRef = ref<HTMLElement | null>(null);
const ITEM_HEIGHT = 72; // 卡片 h-12(48) + p-2(16) + mb-2(8) ≈ 72px

const {
  visibleItems,
  totalHeight,
  offsetY,
  onScroll,
} = useVirtualList<ImageAsset>({
  items: toRef(props, "images"),
  containerRef,
  itemHeight: ITEM_HEIGHT,
  onLoadMore: () => emit("loadMore"),
});

function isAttached(imageId: string, attachedImageIds: string[]) {
  return attachedImageIds.includes(imageId);
}
</script>

<template>
  <div ref="containerRef" class="flex-1 overflow-y-auto p-3" @scroll="onScroll">
    <div
      v-if="!images.length"
      class="flex h-full min-h-55 items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 text-center text-sm text-gray-400"
    >
      {{ activeFilter === "current" ? "当前会话还没有图片" : "图片库还是空的" }}
    </div>

    <!-- 虚拟滚动：外层占位撑总高，内层 translateY 偏移到可见区起点 -->
    <div v-else :style="{ height: totalHeight + 'px' }" class="relative">
      <div :style="{ transform: `translateY(${offsetY}px)` }">
        <ImageCard
          v-for="image in visibleItems"
          :key="image.id"
          :image="image"
          :is-attached="isAttached(image.id, attachedImageIds)"
          :is-selected="selectedImageId === image.id"
          :now-ms="now"
          @attach-image="emit('attachImage', $event)"
          @preview-image="emit('previewImage', $event)"
          @select-image="emit('selectImage', $event)"
        />
      </div>
    </div>

    <div
      v-if="loadingMore"
      class="py-2 text-center text-xs text-gray-400"
    >
      加载更多图片…
    </div>
  </div>
</template>
