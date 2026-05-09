<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../../composables/useNow";
import { formatRelativeTime } from "../../shared/dateTime";
import type { ImageAsset } from "../../types/studio";
import {
  fileSize,
  imageDownloadName,
  imageFormat,
  imageSize,
  sourceLabel,
} from "./imageLibraryFormatters";

const props = defineProps<{
  image: ImageAsset;
  isAttached: boolean;
}>();

const emit = defineEmits<{
  clearSelection: [];
  deleteImage: [id: string];
}>();

const now = useNow();
const createdAtLabel = computed(() =>
  formatRelativeTime(props.image.createdAt, now.value),
);
</script>

<template>
  <div class="border-t border-gray-200 px-4 py-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold text-gray-900">
          {{ image.name }}
        </div>
        <div class="mt-0.5 text-xs text-gray-500">
          {{ sourceLabel(image) }} · {{ createdAtLabel }}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <a
          v-if="image.previewUrl"
          class="rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100"
          :download="imageDownloadName(image)"
          :href="image.previewUrl"
        >
          下载
        </a>
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          type="button"
          @click="emit('deleteImage', image.id)"
        >
          删除
        </button>
        <button
          class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          type="button"
          @click="emit('clearSelection')"
        >
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
      <div>
        <dt class="text-gray-400">格式</dt>
        <dd class="mt-0.5 text-gray-700">
          {{ imageFormat(image) }}
        </dd>
      </div>
      <div>
        <dt class="text-gray-400">尺寸</dt>
        <dd class="mt-0.5 text-gray-700">{{ imageSize(image) }}</dd>
      </div>
      <div>
        <dt class="text-gray-400">文件</dt>
        <dd class="mt-0.5 text-gray-700">{{ fileSize(image) }}</dd>
      </div>
      <div>
        <dt class="text-gray-400">状态</dt>
        <dd class="mt-0.5 text-gray-700">
          {{ isAttached ? "已加入引用" : "未引用" }}
        </dd>
      </div>
    </dl>

    <div class="mt-3">
      <div class="text-xs text-gray-400">Prompt</div>
      <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-600">
        {{ image.prompt }}
      </p>
    </div>
  </div>
</template>
