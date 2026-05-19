<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ImageAsset } from "../../types/studio";

const props = defineProps<{
  image?: ImageAsset;
  maskUrl?: string;
}>();

const emit = defineEmits<{
  close: [];
  editImage: [id: string];
}>();

const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;
let didDrag = false;
let pointerDownOnSelf = false;

const isTransformed = computed(
  () => zoom.value !== 1 || panX.value !== 0 || panY.value !== 0,
);

watch(
  () => props.image?.id,
  () => {
    zoom.value = 1;
    panX.value = 0;
    panY.value = 0;
  },
);

function imageExtension(image?: ImageAsset) {
  if (image?.mimeType === "image/jpeg") return "jpeg";
  if (image?.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image: ImageAsset) {
  return `${image.name || "image"}.${imageExtension(image)}`;
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.12 : 0.12;
  zoom.value = clampZoom(zoom.value + delta);
}

function resetView() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function clampZoom(value: number) {
  return Math.min(4, Math.max(0.5, Number(value.toFixed(2))));
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  pointerDownOnSelf = event.target === event.currentTarget;
  isDragging.value = true;
  didDrag = false;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  panStartX = panX.value;
  panStartY = panY.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    didDrag = true;
  }
  panX.value = panStartX + dx / zoom.value;
  panY.value = panStartY + dy / zoom.value;
}

function onPointerUp() {
  isDragging.value = false;
}

function handleBackdropClick() {
  if (didDrag) return;
  if (!pointerDownOnSelf) return;
  emit("close");
}

function handleEdit() {
  if (!props.image) return;
  emit("editImage", props.image.id);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image?.previewUrl"
      class="fixed inset-0 z-50 bg-black/85 text-white"
      role="dialog"
      aria-modal="true"
    >
      <!-- 图片区域 - 占满全屏，统一处理关闭 -->
      <div
        class="absolute inset-0 flex items-center justify-center"
        :class="isDragging ? 'cursor-grabbing' : 'cursor-grab'"
        @click="handleBackdropClick"
        @wheel="handleWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <div
          class="relative max-h-full max-w-full select-none"
          :style="{
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
          }"
          @dblclick="resetView"
        >
          <img
            class="max-h-[calc(100vh-160px)] max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-75"
            draggable="false"
            :alt="image.name"
            :src="image.previewUrl"
          />
          <div
            v-if="maskUrl"
            class="absolute inset-0 rounded-lg bg-black/60"
            :style="
              {
                maskImage: `url(${maskUrl})`,
                maskSize: '100% 100%',
                maskMode: 'luminance',
                WebkitMaskImage: `url(${maskUrl})`,
                WebkitMaskSize: '100% 100%',
              } as any
            "
          />
        </div>
      </div>

      <!-- 顶部信息栏 -->
      <div class="pointer-events-none absolute top-0 right-0 left-0 z-10 px-5 py-4">
        <div class="pointer-events-auto inline-block max-w-full">
          <div class="truncate text-sm font-semibold">{{ image.name }}</div>
          <div class="mt-0.5 truncate text-xs text-white/60">
            {{ image.prompt }}
          </div>
        </div>
      </div>

      <!-- 底部控制栏 -->
      <div class="pointer-events-none absolute right-0 bottom-0 left-0 z-10 flex justify-center pb-6">
        <div
          class="pointer-events-auto flex items-center gap-1 rounded-xl bg-white/10 p-1.5 backdrop-blur-sm"
        >
          <button
            class="cursor-pointer rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/15"
            type="button"
            title="编辑"
            @click="handleEdit"
          >
            编辑
          </button>
          <a
            class="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/15"
            title="下载"
            :download="imageDownloadName(image)"
            :href="image.previewUrl"
          >
            下载
          </a>
          <button
            class="cursor-pointer rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/15"
            :class="isTransformed ? 'text-white' : 'text-white/40'"
            type="button"
            title="重置视图"
            :disabled="!isTransformed"
            @click="resetView"
          >
            重置
          </button>
          <button
            class="cursor-pointer rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/15"
            type="button"
            title="关闭"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
