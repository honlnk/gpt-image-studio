<script setup lang="ts">
import type { ImageAsset } from "../../../types/studio";

defineProps<{
  imageById: (id: string) => ImageAsset | undefined;
  imageIds: string[];
}>();

const emit = defineEmits<{
  attachImage: [id: string];
}>();
</script>

<template>
  <div v-if="imageIds.length" class="mt-3 flex flex-wrap gap-2">
    <button
      v-for="imageId in imageIds"
      :key="imageId"
      :class="[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
        imageById(imageId)
          ? 'cursor-pointer border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          : 'cursor-not-allowed border-dashed border-gray-300 bg-gray-50 text-gray-400',
      ]"
      type="button"
      :disabled="!imageById(imageId)"
      @click="imageById(imageId) && emit('attachImage', imageId)"
    >
      {{ imageById(imageId)?.name || "图片已删除，无法显示" }}
    </button>
  </div>
</template>
