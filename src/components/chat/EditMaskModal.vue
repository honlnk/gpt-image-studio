<script setup lang="ts">
import { computed, ref } from "vue";
import type { ImageAsset } from "../../types/studio";

const props = defineProps<{
  image?: ImageAsset;
}>();

const emit = defineEmits<{
  close: [];
  apply: [maskBlob: Blob];
}>();

const imageRef = ref<HTMLImageElement | null>(null);
const startX = ref(0);
const startY = ref(0);
const endX = ref(0);
const endY = ref(0);
const isDragging = ref(false);

const rect = computed(() => {
  const left = Math.min(startX.value, endX.value);
  const top = Math.min(startY.value, endY.value);
  const width = Math.abs(endX.value - startX.value);
  const height = Math.abs(endY.value - startY.value);
  return { left, top, width, height };
});

const canApply = computed(() => rect.value.width > 2 && rect.value.height > 2);
const hasSelection = computed(() => rect.value.width > 0 && rect.value.height > 0);

function startSelection(event: PointerEvent) {
  if (!imageRef.value) return;
  const position = pointerPosition(event);
  startX.value = position.x;
  startY.value = position.y;
  endX.value = position.x;
  endY.value = position.y;
  isDragging.value = true;
}

function updateSelection(event: PointerEvent) {
  if (!isDragging.value) return;
  const position = pointerPosition(event);
  endX.value = position.x;
  endY.value = position.y;
}

function stopSelection() {
  isDragging.value = false;
}

function resetSelection() {
  startX.value = 0;
  startY.value = 0;
  endX.value = 0;
  endY.value = 0;
  isDragging.value = false;
}

function pointerPosition(event: PointerEvent) {
  const bounds = imageRef.value?.getBoundingClientRect();
  if (!bounds) return { x: 0, y: 0 };
  const x = clamp(event.clientX - bounds.left, 0, bounds.width);
  const y = clamp(event.clientY - bounds.top, 0, bounds.height);
  return { x, y };
}

async function applyMask() {
  if (!props.image?.previewUrl || !imageRef.value || !canApply.value) return;

  const displayRect = imageRef.value.getBoundingClientRect();
  const naturalWidth = imageRef.value.naturalWidth;
  const naturalHeight = imageRef.value.naturalHeight;
  const scaleX = naturalWidth / displayRect.width;
  const scaleY = naturalHeight / displayRect.height;
  const sourceRect = {
    left: Math.round(rect.value.left * scaleX),
    top: Math.round(rect.value.top * scaleY),
    width: Math.round(rect.value.width * scaleX),
    height: Math.round(rect.value.height * scaleY),
  };

  const canvas = document.createElement("canvas");
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imageData = ctx.createImageData(naturalWidth, naturalHeight);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = 255;
  }

  const startX = clamp(sourceRect.left, 0, naturalWidth);
  const startY = clamp(sourceRect.top, 0, naturalHeight);
  const endX = clamp(sourceRect.left + sourceRect.width, 0, naturalWidth);
  const endY = clamp(sourceRect.top + sourceRect.height, 0, naturalHeight);
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * naturalWidth + x) * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const blob = await canvasToBlob(canvas);
  emit("apply", blob);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成遮罩图片。"));
    }, "image/png");
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image?.previewUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-5xl rounded-xl bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-gray-900">选择要编辑的区域</div>
            <div class="text-xs text-gray-500">拖拽一个矩形区域，透明部分会被模型编辑</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!hasSelection"
              @click="resetSelection"
            >
              重置选区
            </button>
            <button
              class="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              type="button"
              @click="emit('close')"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!canApply"
              @click="applyMask"
            >
              应用区域
            </button>
          </div>
        </div>
        <div class="relative mx-auto max-h-[70vh] overflow-auto rounded-lg bg-gray-50 p-2">
          <div class="relative inline-block">
            <img
              ref="imageRef"
              class="max-h-[66vh] max-w-full select-none rounded object-contain"
              :src="image.previewUrl"
              :alt="image.name"
              @pointerdown.prevent="startSelection"
              @pointermove.prevent="updateSelection"
              @pointerup.prevent="stopSelection"
              @pointerleave.prevent="stopSelection"
            />
            <div
              v-if="canApply || isDragging"
              class="pointer-events-none absolute border-2 border-black bg-black/20"
              :style="{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }"
            />
          </div>
        </div>
        <div class="mt-2 text-xs text-gray-500">
          预览说明：半透明黑色框为将要编辑的区域，提交后该区域会在 mask 中变为透明。
        </div>
      </div>
    </div>
  </Teleport>
</template>
