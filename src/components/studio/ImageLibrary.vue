<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { track } from "../../features/analytics/useAnalyticsTracker";
import { useComposerStore } from "../../stores/composerStore";
import { useConversationsStore } from "../../stores/conversationsStore";
import { useImagesStore } from "../../stores/imagesStore";
import { timestampFromCreatedAt } from "../../shared/dateTime";
import type { ImageAsset } from "../../types/studio";
import ImageDetailsPanel from "../image-library/ImageDetailsPanel.vue";
import ImageGrid from "../image-library/ImageGrid.vue";
import {
  type ImageSourceClass,
  classifyImageSource,
  SOURCE_CLASS_LABELS,
} from "../image-library/imageLibraryFormatters";
import {
  IMAGE_TAG_COLORS,
  imageTagDotColor,
} from "../image-library/imageTagColors";
import StorageUsagePanel from "../image-library/StorageUsagePanel.vue";
import DropdownSelect from "../ui/DropdownSelect.vue";

type SortKey = "time" | "name" | "size";
type SortDirection = "asc" | "desc";

const emit = defineEmits<{
  openBatchOperations: [];
  previewImage: [id: string];
  renameImage: [id: string];
}>();

const composer = useComposerStore();
const conversations = useConversationsStore();
const images = useImagesStore();
const activeFilter = ref<"current" | "all">("current");
const activeColorFilter = ref<"all" | ImageAsset["tagColor"]>("all");
const searchText = ref("");
const sourceFilter = ref<"all" | ImageSourceClass>("all");
const formatFilter = ref<"all" | string>("all");
const sortKey = ref<SortKey>("time");
const sortDirection = ref<SortDirection>("desc");
const selectedImageId = ref("");
const libraryImages = computed(() =>
  images.imageAssets.filter((image) => !image.isTransientMask),
);

const currentConversationImages = computed(() =>
  libraryImages.value.filter(
    (image) => image.conversationId === conversations.activeConversationId,
  ),
);
const scopeImages = computed(() =>
  activeFilter.value === "current"
    ? currentConversationImages.value
    : libraryImages.value,
);

// 已载入图片里出现过的格式（mimeType），供格式筛选下拉动态汇总。
// 用 Map 保留插入顺序，便于下拉稳定排序。
const availableFormats = computed(() => {
  const seen = new Map<string, string>();
  for (const image of scopeImages.value) {
    const mime = image.mimeType;
    if (mime && !seen.has(mime)) {
      seen.set(mime, mime.replace("image/", "").toUpperCase());
    }
  }
  return Array.from(seen, ([value, label]) => ({ value, label }));
});

// 三个筛选下拉的选项（自绘 DropdownSelect 需要 {value,label} 数组）。
const sourceOptions = [
  { value: "all", label: "全部来源" },
  ...Object.entries(SOURCE_CLASS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];
const formatOptions = computed(() => [
  { value: "all", label: "全部格式" },
  ...availableFormats.value,
]);
const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "time", label: "时间" },
  { value: "name", label: "名称" },
  { value: "size", label: "大小" },
];

const trimmedSearch = computed(() => searchText.value.trim().toLowerCase());

function compareText(a: string, b: string) {
  return a.localeCompare(b, "zh-Hans", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareImages(a: ImageAsset, b: ImageAsset) {
  const direction = sortDirection.value === "asc" ? 1 : -1;
  let result = 0;
  if (sortKey.value === "name") {
    result = compareText(a.name, b.name);
  } else if (sortKey.value === "size") {
    result = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
  } else {
    result = timestampFromCreatedAt(a) - timestampFromCreatedAt(b);
  }
  return result * direction || compareText(a.name, b.name);
}

const filteredImages = computed(() => {
  let result = scopeImages.value;
  if (trimmedSearch.value) {
    const needle = trimmedSearch.value;
    result = result.filter((image) =>
      image.name.toLowerCase().includes(needle),
    );
  }
  if (sourceFilter.value !== "all") {
    result = result.filter(
      (image) => classifyImageSource(image) === sourceFilter.value,
    );
  }
  if (formatFilter.value !== "all") {
    result = result.filter((image) => image.mimeType === formatFilter.value);
  }
  if (activeColorFilter.value !== "all") {
    result = result.filter(
      (image) => image.tagColor === activeColorFilter.value,
    );
  }
  // 默认（time/desc）时存储层已按 createdAt DESC 返回，避免无谓拷贝；
  // 仅在非默认排序时排序。
  if (
    sortKey.value !== "time" ||
    sortDirection.value !== "desc" ||
    trimmedSearch.value ||
    sourceFilter.value !== "all" ||
    formatFilter.value !== "all" ||
    activeColorFilter.value !== "all"
  ) {
    result = [...result].sort(compareImages);
  }
  return result;
});

// 是否有非默认筛选/排序激活（用于决定是否提示「仅作用于已载入」）。
const hasActiveFilter = computed(
  () =>
    trimmedSearch.value !== "" ||
    sourceFilter.value !== "all" ||
    formatFilter.value !== "all" ||
    activeColorFilter.value !== "all" ||
    sortKey.value !== "time" ||
    sortDirection.value !== "desc",
);

// 「全部图片」范围是分页加载的；有筛选激活且还有未载入分页时，筛选结果可能不全。
const isScopeIncomplete = computed(
  () =>
    activeFilter.value === "all" &&
    hasActiveFilter.value &&
    Boolean(images.assetsNextCursor),
);

const selectedImage = computed(() => {
  if (!selectedImageId.value) return null;
  return (
    libraryImages.value.find((image) => image.id === selectedImageId.value) ??
    null
  );
});
watch(
  () =>
    [
      libraryImages.value,
      activeFilter.value,
      conversations.activeConversationId,
    ] as const,
  () => {
    if (!selectedImage.value) {
      selectedImageId.value = "";
      return;
    }

    if (
      !filteredImages.value.some(
        (image) => image.id === selectedImage.value?.id,
      )
    ) {
      selectedImageId.value = filteredImages.value[0]?.id ?? "";
    }
  },
);

function onPanelEnter(el: Element, done: () => void) {
  const htmlEl = el as HTMLElement;
  const height = htmlEl.scrollHeight;
  htmlEl.style.overflow = "hidden";
  htmlEl.style.maxHeight = "0px";
  htmlEl.animate(
    [
      { maxHeight: "0px", transform: "translateY(8px)" },
      { maxHeight: `${height}px`, transform: "translateY(0)" },
    ],
    {
      duration: 250,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    },
  ).onfinish = () => {
    htmlEl.style.overflow = "";
    htmlEl.style.maxHeight = "";
    done();
  };
}

function onPanelLeave(el: Element, done: () => void) {
  const htmlEl = el as HTMLElement;
  const height = htmlEl.scrollHeight;
  htmlEl.style.overflow = "hidden";
  htmlEl.animate(
    [
      { maxHeight: `${height}px`, transform: "translateY(0)" },
      { maxHeight: "0px", transform: "translateY(8px)" },
    ],
    {
      duration: 200,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    },
  ).onfinish = () => {
    htmlEl.style.overflow = "";
    htmlEl.style.maxHeight = "";
    done();
  };
}

function selectImage(id: string) {
  selectedImageId.value = id;
}

function isAttached(id: string) {
  return images.attachedImages.includes(id);
}

function toggleColorFilter(nextColor: ImageAsset["tagColor"] | "all") {
  activeColorFilter.value = nextColor;
}

function toggleSortDirection() {
  sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
}

function onSortKeyChange(value: string) {
  if (value !== sortKey.value) {
    sortKey.value = value as SortKey;
    track("library.sort_changed", {
      target: "images",
      key: value,
      direction: sortDirection.value,
    });
  }
}

function onSourceFilterChange(value: string) {
  sourceFilter.value = value as "all" | ImageSourceClass;
  track("library.filter_by_source", { source: value });
}

function onFormatFilterChange(value: string) {
  formatFilter.value = value;
  track("library.filter_by_format", { format: value });
}

function onSearchInput() {
  const length = searchText.value.trim().length;
  if (length > 0) {
    track("library.search_used", { target: "library", length });
  }
}

// 切换范围时重置格式筛选——新范围的可用格式集合可能不同，避免选中一个
// 在新范围里不存在的格式导致列表恒空。
watch(activeFilter, () => {
  formatFilter.value = "all";
});

function resetFilters() {
  searchText.value = "";
  sourceFilter.value = "all";
  formatFilter.value = "all";
  activeColorFilter.value = "all";
  sortKey.value = "time";
  sortDirection.value = "desc";
}

// 头部计数（server 模式分页 PR-d）：窗口是分页加载的，length 只是"已加载"，
// "全部图片" tab 显示服务端 total；"当前会话" 经 ensureConversationAssets 全量
// 加载，length 即真实总数。
const imageCountLabel = computed(() =>
  activeFilter.value === "all"
    ? images.assetsTotal
    : currentConversationImages.value.length,
);

// 滚到底加载下一页：只有"全部图片"tab 走分页；"当前会话"已全量在内存。
function onGridLoadMore() {
  if (activeFilter.value !== "all") return;
  void images.loadMoreAssets();
}

function setImageTagColor(
  id: string,
  color: ImageAsset["tagColor"] | undefined,
) {
  images.setImageTagColor(id, color);
}
</script>

<template>
  <div
    v-if="composer.isLibraryOpen"
    class="fixed inset-0 z-10 bg-black/25 lg:hidden"
    role="presentation"
    @click="composer.setLibraryOpen(false)"
  ></div>
  <aside
    :class="[
      'flex w-[320px] shrink-0 flex-col border-l border-gray-200 bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
      composer.isLibraryOpen
        ? 'max-lg:translate-x-0'
        : 'max-lg:translate-x-full',
    ]"
    aria-label="图片库"
  >
    <div class="border-b border-gray-200 px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-gray-800">图片库</span>
          <span class="text-sm text-gray-500"
            >{{ imageCountLabel }} 张图片</span
          >
        </div>
        <div class="flex items-center gap-1">
          <button
            class="cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            type="button"
            @click="emit('openBatchOperations')"
          >
            批量下载
          </button>
          <button
            class="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:hidden"
            aria-label="关闭图片库"
            type="button"
            @click="composer.setLibraryOpen(false)"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>
      </div>
      <StorageUsagePanel
        v-if="images.storageUsage"
        :storage-usage="images.storageUsage"
      />

      <div class="mt-3 grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm">
        <button
          :class="[
            'cursor-pointer rounded-md px-2 py-1 transition-colors',
            activeFilter === 'current'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-800',
          ]"
          type="button"
          v-track="{ name: 'library.filter_changed', payload: { scope: 'current' } }"
          @click="activeFilter = 'current'"
        >
          当前会话
        </button>
        <button
          :class="[
            'cursor-pointer rounded-md px-2 py-1 transition-colors',
            activeFilter === 'all'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-800',
          ]"
          type="button"
          v-track="{ name: 'library.filter_changed', payload: { scope: 'all' } }"
          @click="activeFilter = 'all'"
        >
          全部图片
        </button>
      </div>
      <div class="mt-2 flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-2">
        <button
          aria-label="不过滤颜色"
          :class="[
            'h-3 w-3 cursor-pointer rounded-full border transition-transform hover:scale-105',
            activeColorFilter === 'all'
              ? 'border-gray-700 ring-2 ring-gray-400/60'
              : 'border-gray-300',
          ]"
          style="background-color: #ffffff"
          type="button"
          v-track="{ name: 'library.filter_by_tag_color', payload: { color: 'all' } }"
          @click="toggleColorFilter('all')"
        />
        <button
          v-for="color in IMAGE_TAG_COLORS"
          :key="color"
          :aria-label="`筛选${color}`"
          :class="[
            'h-3 w-3 cursor-pointer rounded-full border transition-transform hover:scale-105',
            activeColorFilter === color
              ? 'border-gray-700 ring-2 ring-gray-400/60'
              : 'border-gray-300',
          ]"
          :style="{ backgroundColor: imageTagDotColor(color) }"
          type="button"
          v-track="{ name: 'library.filter_by_tag_color', payload: { color } }"
          @click="toggleColorFilter(color)"
        />
      </div>

      <div class="mt-2 flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5">
        <svg
          class="h-3.5 w-3.5 shrink-0 text-gray-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
            clip-rule="evenodd"
          />
        </svg>
        <input
          v-model="searchText"
          class="min-w-0 flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none"
          placeholder="搜索图片名"
          type="search"
          @input="onSearchInput"
        />
        <button
          v-if="searchText"
          aria-label="清除搜索"
          class="shrink-0 cursor-pointer rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          type="button"
          @click="searchText = ''"
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>

      <div class="mt-2 grid grid-cols-3 gap-1.5">
        <DropdownSelect
          aria-label="按来源筛选"
          :model-value="sourceFilter"
          :options="sourceOptions"
          size="sm"
          @update:model-value="onSourceFilterChange"
        />
        <DropdownSelect
          aria-label="按格式筛选"
          :disabled="availableFormats.length === 0"
          :model-value="formatFilter"
          :options="formatOptions"
          size="sm"
          @update:model-value="onFormatFilterChange"
        />
        <div class="flex min-w-0 items-center gap-0.5">
          <DropdownSelect
            aria-label="排序方式"
            class="min-w-0 flex-1"
            :model-value="sortKey"
            :options="SORT_OPTIONS"
            size="sm"
            @update:model-value="onSortKeyChange"
          />
          <button
            :aria-label="sortDirection === 'asc' ? '升序' : '降序'"
            class="shrink-0 cursor-pointer rounded-md border border-gray-200 bg-white px-1.5 py-1 text-gray-600 hover:bg-gray-50"
            type="button"
            @click="toggleSortDirection"
          >
            <svg
              class="h-3.5 w-3.5 transition-transform"
              :class="sortDirection === 'asc' ? '' : 'rotate-180'"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      <button
        v-if="hasActiveFilter"
        class="mt-1.5 cursor-pointer self-start text-xs text-gray-400 hover:text-gray-600"
        type="button"
        @click="resetFilters"
      >
        清除筛选/排序
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <p
        v-if="isScopeIncomplete"
        class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-700"
      >
        筛选仅作用于已载入图片（{{ filteredImages.length }}/{{
          libraryImages.length
        }} 条），向下滚动加载更多
      </p>
      <ImageGrid
        :active-filter="activeFilter"
        :attached-image-ids="images.attachedImages"
        :images="filteredImages"
        :loading-more="activeFilter === 'all' && images.isLoadingMoreAssets"
        :selected-image-id="selectedImage?.id ?? ''"
        @attach-image="images.attachImage"
        @load-more="onGridLoadMore"
        @preview-image="emit('previewImage', $event)"
        @select-image="selectImage"
      />

      <Transition :css="false" @enter="onPanelEnter" @leave="onPanelLeave">
        <ImageDetailsPanel
          v-if="selectedImage"
          :image="selectedImage"
          :is-attached="isAttached(selectedImage.id)"
          @clear-selection="selectedImageId = ''"
          @delete-image="images.deleteImage"
          @rename-image="emit('renameImage', $event)"
          @set-tag-color="setImageTagColor"
        />
      </Transition>
    </div>
  </aside>
</template>
