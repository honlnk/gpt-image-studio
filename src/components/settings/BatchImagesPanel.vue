<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../../composables/useNow";
import { formatRelativeTime } from "../../shared/dateTime";
import type { ImageAsset } from "../../types/studio";

type SortDirection = "asc" | "desc";
type ImageSortKey = "name" | "size" | "time";

const props = defineProps<{
  imageSortDirection: SortDirection;
  imageSortKey: ImageSortKey;
  images: ImageAsset[];
  imageSortOptions: { key: ImageSortKey; label: string }[];
  filteredImages: ImageAsset[];
  searchText: string;
  selectedImageIds: Set<string>;
  selectedImages: ImageAsset[];
}>();

const emit = defineEmits<{
  clearSelection: [];
  deleteSelected: [];
  downloadSelected: [];
  previewImage: [id: string];
  selectAll: [];
  setSort: [key: ImageSortKey];
  toggleSelection: [id: string];
}>();

function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return fileSize(image);
}

function fileSize(image: ImageAsset) {
  if (!image.sizeBytes) return "未知大小";
  if (image.sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(image.sizeBytes / 1024))} KB`;
  }
  return `${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

const now = useNow();
const createdAtLabels = computed(() =>
  new Map(
    props.filteredImages.map((image) => [
      image.id,
      formatRelativeTime(image.createdAt, now.value),
    ]),
  ),
);
</script>

<template>
  <section
    class="mt-5 flex min-h-0 flex-1 flex-col"
    aria-labelledby="batchImagesTitle"
  >
    <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div>
        <h4
          id="batchImagesTitle"
          class="text-sm font-semibold text-gray-900"
        >
          图片
        </h4>
        <p class="mt-0.5 text-xs text-gray-500">
          找到 {{ filteredImages.length }} 张，共 {{ images.length }} 张，已选
          {{ selectedImages.length }} 张
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-1 text-xs">
        <span class="text-gray-400">排序</span>
        <button
          v-for="option in imageSortOptions"
          :key="option.key"
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 transition-colors"
          :class="
            imageSortKey === option.key
              ? 'bg-gray-100 font-medium text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
          "
          type="button"
          @click="emit('setSort', option.key)"
        >
          {{ option.label }}
          <svg
            v-if="imageSortKey === option.key"
            class="h-3 w-3 transition-transform"
            :class="{ 'rotate-180': imageSortDirection === 'desc' }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
      <div class="flex shrink-0 gap-1 text-xs">
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          type="button"
          @click="emit('selectAll')"
        >
          全选
        </button>
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          type="button"
          @click="emit('clearSelection')"
        >
          清空
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <article
        v-for="image in filteredImages"
        :key="image.id"
        :class="[
          'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition-colors',
          selectedImageIds.has(image.id)
            ? 'border-gray-900 bg-gray-50 shadow-sm'
            : image.previewUrl
              ? 'border-gray-200 hover:bg-gray-50'
              : 'border-gray-200 opacity-60',
        ]"
        @click="image.previewUrl && emit('toggleSelection', image.id)"
      >
        <div
          :class="[
            'group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400',
            selectedImageIds.has(image.id)
              ? 'ring-2 ring-gray-900 ring-offset-1'
              : '',
          ]"
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
          <span
            v-if="selectedImageIds.has(image.id)"
            class="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white shadow"
            aria-hidden="true"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42 0L3.29 9.224a1 1 0 1 1 1.42-1.408l4.04 4.074 6.54-6.594a1 1 0 0 1 1.414-.006z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </div>
        <div>
          <p class="truncate text-sm font-medium text-gray-800">
            {{ image.name }}
          </p>
          <p class="truncate text-xs text-gray-500">
            {{ sourceLabel(image) }} · {{ createdAtLabels.get(image.id) }} ·
            {{ imageSize(image) }}
          </p>
        </div>
      </article>
      <div
        v-if="!filteredImages.length"
        class="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center"
      >
        <p
          v-if="searchText"
          class="text-sm font-medium text-gray-600"
        >
          没有找到匹配的图片
        </p>
        <p
          v-else
          class="text-sm font-medium text-gray-600"
        >
          还没有可批量处理的图片
        </p>
        <p class="mt-1 text-xs leading-relaxed text-gray-400">
          {{
            searchText
              ? "换一个图片名称关键词试试。"
              : "生成图片或从输入框导入本地图片后，这里会显示可下载和可删除的图片列表。"
          }}
        </p>
      </div>
    </div>

    <div class="mt-3 flex shrink-0 gap-2">
      <button
        class="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!selectedImages.length"
        type="button"
        @click="emit('downloadSelected')"
      >
        下载 ZIP ({{ selectedImages.length }})
      </button>
      <button
        class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
        :disabled="!selectedImages.length"
        type="button"
        @click="emit('deleteSelected')"
      >
        删除选中图片 ({{ selectedImages.length }})
      </button>
    </div>
  </section>
</template>
