<script setup lang="ts">
import type { ImageAsset } from "../../types/studio";

defineProps<{
  image: ImageAsset;
  isAttached: boolean;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  previewImage: [id: string];
  selectImage: [id: string];
}>();

function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

function imageExtension(image: ImageAsset) {
  if (image.mimeType === "image/jpeg") return "jpeg";
  if (image.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image: ImageAsset) {
  return `${image.name || "image"}.${imageExtension(image)}`;
}
</script>

<template>
  <article
    :class="[
      'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition-colors',
      isSelected
        ? 'border-gray-400 bg-gray-50'
        : 'border-gray-200 hover:bg-gray-50',
    ]"
    @click="emit('selectImage', image.id)"
  >
    <div
      class="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400"
      @click.stop="image.previewUrl && emit('previewImage', image.id)"
    >
      <img
        v-if="image.previewUrl"
        class="h-full w-full rounded-lg object-cover"
        :alt="image.name"
        :src="image.previewUrl"
      />
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
      <div class="truncate text-sm font-medium text-gray-800">
        {{ image.name }}
      </div>
      <div class="truncate text-xs text-gray-500">
        {{ sourceLabel(image) }} · {{ image.createdAt }}
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <a
        v-if="image.previewUrl"
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
