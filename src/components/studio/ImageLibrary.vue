<script setup lang="ts">
import type { ImageAsset } from "../../types/studio";

defineProps<{
  images: ImageAsset[];
  isOpen: boolean;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  "update:isOpen": [value: boolean];
}>();
</script>

<template>
  <aside
    :class="[
      'flex w-[300px] shrink-0 flex-col border-l border-gray-200 bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:transition-transform max-lg:duration-200',
      isOpen
        ? 'max-lg:translate-x-0'
        : 'max-lg:translate-x-full max-lg:hidden',
    ]"
    aria-label="图片库"
  >
    <div
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-base font-semibold text-gray-800">图片库</span>
        <span class="text-sm text-gray-500">
          {{ images.length }} 张图片
        </span>
      </div>
      <button
        class="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:hidden"
        type="button"
        @click="emit('update:isOpen', false)"
      >
        ✕
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <article
        v-for="image in images"
        :key="image.id"
        class="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 p-2 transition-colors hover:bg-gray-50"
      >
        <div
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400"
        >
          img
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-gray-800">
            {{ image.name }}
          </div>
          <div class="truncate text-xs text-gray-500">
            {{ image.source === "generated" ? "生成图" : "参考图" }} ·
            {{ image.createdAt }}
          </div>
        </div>
        <button
          class="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          type="button"
          @click="emit('attachImage', image.id)"
        >
          引用
        </button>
      </article>
    </div>
  </aside>
</template>
