<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatRelativeTime } from "../../shared/dateTime";
import { useImagesStore } from "../../stores/imagesStore";
import type { ImageAsset } from "../../types/studio";
import {
  imageDownloadName,
  sourceLabel,
} from "./imageLibraryFormatters";
import { imageTagCardBackground, imageTagDotColor } from "./imageTagColors";

const props = defineProps<{
  image: ImageAsset;
  isAttached: boolean;
  isSelected: boolean;
  nowMs: number;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  previewImage: [id: string];
  selectImage: [id: string];
}>();

const imagesStore = useImagesStore();

// PR9 懒加载：缩略图进入视口（含 200px 预取边距）才请求 blob。
// 每张卡片自观察——图片库是 overflow 滚动容器，root=null（视口）即可正确触发，
// 且对过滤/切换导致的列表重建天然健壮。
const thumbRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (props.image.previewUrl || !props.image.blobKey) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      imagesStore.ensurePreviewLoaded(props.image.id);
      observer?.disconnect();
      observer = null;
    },
    { rootMargin: "200px" },
  );
  if (thumbRef.value) observer.observe(thumbRef.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const createdAtLabel = computed(() =>
  formatRelativeTime(props.image.createdAt, props.nowMs),
);
const cardStyle = computed(() => {
  if (!props.image.tagColor) return undefined;
  return {
    backgroundColor: imageTagCardBackground(props.image.tagColor),
  };
});
const selectedAccentColor = computed(() => {
  if (!props.isSelected) return undefined;
  if (!props.image.tagColor) return "#6b7280";
  return imageTagDotColor(props.image.tagColor);
});
const selectedBorderStyle = computed(() => {
  if (!selectedAccentColor.value) return undefined;
  return {
    borderColor: selectedAccentColor.value,
  };
});
const titleStyle = computed(() => {
  if (!selectedAccentColor.value) return undefined;
  return {
    color: selectedAccentColor.value,
  };
});
</script>

<template>
  <article
    :class="[
      'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition-colors',
      isSelected ? '' : 'border-gray-200 hover:bg-gray-50',
    ]"
    :style="[cardStyle, selectedBorderStyle]"
    @click="emit('selectImage', image.id)"
  >
    <div
      ref="thumbRef"
      class="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400"
      @click.stop="image.previewUrl && emit('previewImage', image.id)"
    >
      <img
        v-if="image.previewUrl"
        class="h-full w-full rounded-lg object-cover"
        :alt="image.name"
        :src="image.previewUrl"
      />
      <!-- PR9 三态：加载失败可重试 / 加载中转圈 / idle（进入视口即触发加载） -->
      <button
        v-else-if="imagesStore.isPreviewError(image.id)"
        class="h-full w-full cursor-pointer rounded-lg text-gray-400 hover:bg-gray-200"
        type="button"
        title="加载失败，点击重试"
        @click.stop="imagesStore.ensurePreviewLoaded(image.id)"
      >
        !
      </button>
      <span
        v-else-if="imagesStore.isPreviewLoading(image.id)"
        class="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500"
      ></span>
      <span v-else>img</span>
      <button
        v-if="image.previewUrl"
        class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-lg bg-black/45 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
        type="button"
        @click.stop="emit('previewImage', image.id)"
      >
        点击查看
      </button>
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium text-gray-800" :style="titleStyle">
        {{ image.name }}
      </div>
      <div class="truncate text-xs text-gray-500">
        {{ sourceLabel(image) }} · {{ createdAtLabel }}
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <a
        v-if="image.previewUrl"
        v-track="{ name: 'image.downloaded', payload: { imageId: image.id, location: 'card' } }"
        class="rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        :download="imageDownloadName(image)"
        :href="image.previewUrl"
        @click.stop
      >
        下载
      </a>
      <button
        :class="[
          'cursor-pointer rounded-lg px-2 py-1 text-xs transition-colors',
          isAttached
            ? 'bg-gray-100 text-gray-400'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        ]"
        type="button"
        @click.stop="emit('attachImage', image.id)"
      >
        {{ isAttached ? "已引用" : "引用" }}
      </button>
    </div>
  </article>
</template>
