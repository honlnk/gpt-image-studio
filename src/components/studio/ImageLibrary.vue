<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ImageAsset } from "../../types/studio";

const props = defineProps<{
  activeConversationId: string;
  attachedImageIds: string[];
  images: ImageAsset[];
  isOpen: boolean;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  deleteImage: [id: string];
  "update:isOpen": [value: boolean];
}>();

const activeFilter = ref<"current" | "all">("current");
const selectedImageId = ref("");

const currentConversationImages = computed(() =>
  props.images.filter(
    (image) => image.conversationId === props.activeConversationId,
  ),
);
const filteredImages = computed(() =>
  activeFilter.value === "current" ? currentConversationImages.value : props.images,
);
const selectedImage = computed(
  () =>
    props.images.find((image) => image.id === selectedImageId.value) ??
    filteredImages.value[0],
);

watch(
  () => [props.images, activeFilter.value, props.activeConversationId] as const,
  () => {
    if (!selectedImage.value) {
      selectedImageId.value = "";
      return;
    }

    if (!filteredImages.value.some((image) => image.id === selectedImage.value?.id)) {
      selectedImageId.value = filteredImages.value[0]?.id ?? "";
    }
  },
);

function selectImage(id: string) {
  selectedImageId.value = id;
}

function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

function imageFormat(image: ImageAsset) {
  return image.mimeType?.replace("image/", "").toUpperCase() ?? "未知";
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

function isAttached(id: string) {
  return props.attachedImageIds.includes(id);
}
</script>

<template>
  <aside
    :class="[
      'flex w-[320px] shrink-0 flex-col border-l border-gray-200 bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:transition-transform max-lg:duration-200',
      isOpen
        ? 'max-lg:translate-x-0'
        : 'max-lg:translate-x-full max-lg:hidden',
    ]"
    aria-label="图片库"
  >
    <div class="border-b border-gray-200 px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-gray-800">图片库</span>
          <span class="text-sm text-gray-500">{{ images.length }} 张图片</span>
        </div>
        <button
          class="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:hidden"
          aria-label="关闭图片库"
          type="button"
          @click="emit('update:isOpen', false)"
        >
          x
        </button>
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
          class="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-dashed border-gray-200 px-6 text-center text-sm text-gray-400"
        >
          {{ activeFilter === "current" ? "当前会话还没有图片" : "图片库还是空的" }}
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
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400"
          >
            <img
              v-if="image.previewUrl"
              class="h-full w-full rounded-lg object-cover"
              :alt="image.name"
              :src="image.previewUrl"
            />
            <span v-else>img</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-gray-800">
              {{ image.name }}
            </div>
            <div class="truncate text-xs text-gray-500">
              {{ sourceLabel(image) }} · {{ image.createdAt }}
            </div>
          </div>
          <button
            :class="[
              'shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs transition-colors',
              isAttached(image.id)
                ? 'bg-gray-100 text-gray-400'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
            ]"
            type="button"
            @click.stop="emit('attachImage', image.id)"
          >
            {{ isAttached(image.id) ? "已引用" : "引用" }}
          </button>
        </article>
      </div>

      <div
        v-if="selectedImage"
        class="border-t border-gray-200 px-4 py-3"
      >
        <div class="mb-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-gray-900">
              {{ selectedImage.name }}
            </div>
            <div class="mt-0.5 text-xs text-gray-500">
              {{ sourceLabel(selectedImage) }} · {{ selectedImage.createdAt }}
            </div>
          </div>
          <button
            class="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
            type="button"
            @click="emit('deleteImage', selectedImage.id)"
          >
            删除
          </button>
        </div>

        <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt class="text-gray-400">格式</dt>
            <dd class="mt-0.5 text-gray-700">{{ imageFormat(selectedImage) }}</dd>
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
    </div>
  </aside>
</template>
