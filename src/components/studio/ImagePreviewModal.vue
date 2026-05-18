<script setup lang="ts">
import { ref, watch } from "vue";
import type { ImageAsset } from "../../types/studio";

const props = defineProps<{
  image?: ImageAsset;
  maskUrl?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const zoom = ref(1);

watch(
  () => props.image?.id,
  () => {
    zoom.value = 1;
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

function resetZoom() {
  zoom.value = 1;
}

function clampZoom(value: number) {
  return Math.min(4, Math.max(0.5, Number(value.toFixed(2))));
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image?.previewUrl"
      class="fixed inset-0 z-50 flex flex-col bg-black/85 text-white"
      role="dialog"
      aria-modal="true"
      @mousedown.self="emit('close')"
    >
      <div class="flex items-center justify-between gap-4 px-5 py-4">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold">{{ image.name }}</div>
          <div class="mt-0.5 truncate text-xs text-white/60">
            {{ image.prompt }}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <a
            class="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
            :download="imageDownloadName(image)"
            :href="image.previewUrl"
          >
            下载
          </a>
          <button
            class="cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20"
            type="button"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>
      </div>

      <div
        class="flex min-h-0 flex-1 items-center justify-center px-5 pb-5"
        @click.self="emit('close')"
        @wheel="handleWheel"
      >
        <div
          class="relative max-h-full max-w-full"
          :style="{ transform: `scale(${zoom})` }"
          @dblclick="resetZoom"
        >
          <img
            class="max-h-[calc(100vh-120px)] max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-75"
            :alt="image.name"
            :src="image.previewUrl"
          />
          <div
            v-if="maskUrl"
            class="absolute inset-0 rounded-lg bg-black/60"
            :style="{
              maskImage: `url(${maskUrl})`,
              maskSize: '100% 100%',
              maskMode: 'luminance',
              WebkitMaskImage: `url(${maskUrl})`,
              WebkitMaskSize: '100% 100%',
            } as any"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>
