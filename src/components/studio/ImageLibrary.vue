<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StorageUsage } from "../../services/storageUsage";
import type { ImageAsset } from "../../types/studio";
import ImageDetailsPanel from "../image-library/ImageDetailsPanel.vue";
import ImageGrid from "../image-library/ImageGrid.vue";
import Tooltip from "../ui/Tooltip.vue";

const props = defineProps<{
  activeConversationId: string;
  attachedImageIds: string[];
  images: ImageAsset[];
  isOpen: boolean;
  storageUsage: StorageUsage | null;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  deleteImage: [id: string];
  openBatchOperations: [];
  previewImage: [id: string];
  "update:isOpen": [value: boolean];
}>();

const activeFilter = ref<"current" | "all">("current");
const selectedImageId = ref("");
const storageExpanded = ref(false);

const currentConversationImages = computed(() =>
  props.images.filter(
    (image) => image.conversationId === props.activeConversationId,
  ),
);
const filteredImages = computed(() =>
  activeFilter.value === "current"
    ? currentConversationImages.value
    : props.images,
);
const selectedImage = computed(() => {
  if (!selectedImageId.value) return null;
  return (
    props.images.find((image) => image.id === selectedImageId.value) ?? null
  );
});
const storageTotalBytes = computed(
  () => props.storageUsage?.quotaBytes || props.storageUsage?.projectBytes || 0,
);
const storageUsedPercent = computed(() => {
  if (!props.storageUsage?.quotaBytes) return 0;

  return percentOf(
    props.storageUsage.projectBytes,
    props.storageUsage.quotaBytes,
  );
});
const imageStoragePercent = computed(() =>
  percentOf(props.storageUsage?.imageBytes ?? 0, storageTotalBytes.value),
);
const metadataStoragePercent = computed(() =>
  percentOf(props.storageUsage?.metadataBytes ?? 0, storageTotalBytes.value),
);

watch(
  () => [props.images, activeFilter.value, props.activeConversationId] as const,
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
    { duration: 250, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
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
    { duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  ).onfinish = () => {
    htmlEl.style.overflow = "";
    htmlEl.style.maxHeight = "";
    done();
  };
}

function selectImage(id: string) {
  selectedImageId.value = id;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function percentOf(value: number, total: number) {
  if (!total) return 0;

  return Math.min(100, Math.max(0, (value / total) * 100));
}

function isAttached(id: string) {
  return props.attachedImageIds.includes(id);
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-10 bg-black/25 lg:hidden"
    role="presentation"
    @click="emit('update:isOpen', false)"
  ></div>
  <aside
    :class="[
      'flex w-[320px] shrink-0 flex-col border-l border-gray-200 bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
      isOpen ? 'max-lg:translate-x-0' : 'max-lg:translate-x-full',
    ]"
    aria-label="图片库"
  >
    <div class="border-b border-gray-200 px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-gray-800">图片库</span>
          <span class="text-sm text-gray-500">{{ images.length }} 张图片</span>
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
            @click="emit('update:isOpen', false)"
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
      <div
        v-if="storageUsage"
        class="mt-3 rounded-lg border border-gray-200 bg-gray-50"
      >
        <button
          class="flex w-full items-center gap-2 px-3 py-2 text-xs text-left"
          @click="storageExpanded = !storageExpanded"
        >
          <svg
            class="h-3 w-3 shrink-0 text-gray-400 transition-transform"
            :class="{ 'rotate-90': storageExpanded }"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clip-rule="evenodd"
            />
          </svg>
          <span class="font-medium text-gray-700">本地存储</span>
          <span class="ml-auto inline-flex items-center gap-1 text-gray-500">
            {{ formatBytes(storageUsage.projectBytes) }}
            <template v-if="storageUsage.quotaBytes">
              / {{ formatBytes(storageUsage.quotaBytes) }}
            </template>
          </span>
          <Tooltip text="根据当前浏览器和设备状态估算，可用空间可能会变化。">
            <span
              class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-500 transition-colors hover:bg-gray-300"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </span>
          </Tooltip>
        </button>
        <div v-show="storageExpanded" class="px-3 pb-3 pt-0">
          <div class="flex h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              class="h-full flex-none bg-gray-900"
              :style="{ width: `${imageStoragePercent}%` }"
              title="图片数据"
            ></div>
            <div
              class="h-full flex-none bg-gray-400"
              :style="{ width: `${metadataStoragePercent}%` }"
              title="文本与索引"
            ></div>
          </div>
          <div
            class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
          >
            <span class="inline-flex items-center gap-1">
              <span class="h-2 w-2 rounded-full bg-gray-900"></span>
              图片 {{ formatBytes(storageUsage.imageBytes) }}
            </span>
            <span class="inline-flex items-center gap-1">
              <span class="h-2 w-2 rounded-full bg-gray-400"></span>
              文本与索引 {{ formatBytes(storageUsage.metadataBytes) }}
            </span>
            <span v-if="storageUsage.quotaBytes" class="ml-auto">
              {{ storageUsedPercent.toFixed(1) }}%
            </span>
            <span v-else class="ml-auto">浏览器未提供上限</span>
          </div>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm">
        <button
          :class="[
            'cursor-pointer rounded-md px-2 py-1 transition-colors',
            activeFilter === 'current'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-800',
          ]"
          type="button"
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
          @click="activeFilter = 'all'"
        >
          全部图片
        </button>
      </div>

    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <ImageGrid
        :active-filter="activeFilter"
        :attached-image-ids="attachedImageIds"
        :images="filteredImages"
        :selected-image-id="selectedImage?.id ?? ''"
        @attach-image="emit('attachImage', $event)"
        @preview-image="emit('previewImage', $event)"
        @select-image="selectImage"
      />

      <Transition
        :css="false"
        @enter="onPanelEnter"
        @leave="onPanelLeave"
      >
        <ImageDetailsPanel
          v-if="selectedImage"
          :image="selectedImage"
          :is-attached="isAttached(selectedImage.id)"
          @clear-selection="selectedImageId = ''"
          @delete-image="emit('deleteImage', $event)"
        />
      </Transition>
    </div>
  </aside>
</template>
