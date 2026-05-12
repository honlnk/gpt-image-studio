<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StorageUsage } from "../../services/storageUsage";
import type { ImageAsset } from "../../types/studio";
import { IMAGE_TAG_COLORS, imageTagDotColor } from "../image-library/imageTagColors";
import ImageDetailsPanel from "../image-library/ImageDetailsPanel.vue";
import ImageGrid from "../image-library/ImageGrid.vue";
import StorageUsagePanel from "../image-library/StorageUsagePanel.vue";

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
  renameImage: [id: string];
  setImageTagColor: [id: string, color: ImageAsset["tagColor"] | undefined];
  "update:isOpen": [value: boolean];
}>();

const activeFilter = ref<"current" | "all">("current");
const activeColorFilter = ref<"all" | ImageAsset["tagColor"]>("all");
const selectedImageId = ref("");

const currentConversationImages = computed(() =>
  props.images.filter(
    (image) => image.conversationId === props.activeConversationId,
  ),
);
const scopeImages = computed(() =>
  activeFilter.value === "current" ? currentConversationImages.value : props.images,
);
const filteredImages = computed(() => {
  if (activeColorFilter.value === "all") return scopeImages.value;
  return scopeImages.value.filter((image) => image.tagColor === activeColorFilter.value);
});
const selectedImage = computed(() => {
  if (!selectedImageId.value) return null;
  return (
    props.images.find((image) => image.id === selectedImageId.value) ?? null
  );
});
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

function isAttached(id: string) {
  return props.attachedImageIds.includes(id);
}

function toggleColorFilter(nextColor: ImageAsset["tagColor"] | "all") {
  activeColorFilter.value = nextColor;
}

function setImageTagColor(id: string, color: ImageAsset["tagColor"] | undefined) {
  emit("setImageTagColor", id, color);
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
      <StorageUsagePanel
        v-if="storageUsage"
        :storage-usage="storageUsage"
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
          @click="toggleColorFilter(color)"
        />
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
          @rename-image="emit('renameImage', $event)"
          @set-tag-color="setImageTagColor"
        />
      </Transition>
    </div>
  </aside>
</template>
