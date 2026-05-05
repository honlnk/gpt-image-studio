<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StorageUsage } from "../../services/storageUsage";
import type { ImageAsset } from "../../types/studio";
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

function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

function imageFormat(image: ImageAsset) {
  return image.mimeType?.replace("image/", "").toUpperCase() ?? "未知";
}

function imageExtension(image: ImageAsset) {
  if (image.mimeType === "image/jpeg") return "jpeg";
  if (image.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image: ImageAsset) {
  return `${image.name || "image"}.${imageExtension(image)}`;
}

function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return "未记录";
}

function fileSize(image: ImageAsset) {
  if (!image.sizeBytes) return "未知大小";
  if (image.sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(image.sizeBytes / 1024))} KB`;
  }

  return `${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
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
      <div class="flex-1 overflow-y-auto p-3">
        <div
          v-if="!filteredImages.length"
          class="flex h-full min-h-55 items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 text-center text-sm text-gray-400"
        >
          {{
            activeFilter === "current" ? "当前会话还没有图片" : "图片库还是空的"
          }}
        </div>

        <article
          v-for="image in filteredImages"
          :key="image.id"
          :class="[
            'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition-colors',
            selectedImage?.id === image.id
              ? 'border-gray-400 bg-gray-50'
              : 'border-gray-200 hover:bg-gray-50',
          ]"
          @click="selectImage(image.id)"
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
                isAttached(image.id)
                  ? 'bg-gray-100 text-gray-400'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
              ]"
              type="button"
              @click.stop="emit('attachImage', image.id)"
            >
              {{ isAttached(image.id) ? "已引用" : "引用" }}
            </button>
          </div>
        </article>
      </div>

      <Transition
        :css="false"
        @enter="onPanelEnter"
        @leave="onPanelLeave"
      >
        <div v-if="selectedImage" class="border-t border-gray-200 px-4 py-3">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-gray-900">
                {{ selectedImage.name }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500">
                {{ sourceLabel(selectedImage) }} · {{ selectedImage.createdAt }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <a
                v-if="selectedImage.previewUrl"
                class="rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100"
                :download="imageDownloadName(selectedImage)"
                :href="selectedImage.previewUrl"
              >
                下载
              </a>
              <button
                class="cursor-pointer rounded-lg px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
                type="button"
                @click="emit('deleteImage', selectedImage.id)"
              >
                删除
              </button>
              <button
                class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                type="button"
                @click="selectedImageId = ''"
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
                {{ imageFormat(selectedImage) }}
              </dd>
            </div>
            <div>
              <dt class="text-gray-400">尺寸</dt>
              <dd class="mt-0.5 text-gray-700">{{ imageSize(selectedImage) }}</dd>
            </div>
            <div>
              <dt class="text-gray-400">文件</dt>
              <dd class="mt-0.5 text-gray-700">{{ fileSize(selectedImage) }}</dd>
            </div>
            <div>
              <dt class="text-gray-400">状态</dt>
              <dd class="mt-0.5 text-gray-700">
                {{ isAttached(selectedImage.id) ? "已加入引用" : "未引用" }}
              </dd>
            </div>
          </dl>

          <div class="mt-3">
            <div class="text-xs text-gray-400">Prompt</div>
            <p class="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-600">
              {{ selectedImage.prompt }}
            </p>
          </div>
        </div>
      </Transition>
    </div>
  </aside>
</template>
