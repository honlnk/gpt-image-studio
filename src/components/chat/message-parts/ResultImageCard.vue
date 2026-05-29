<script setup lang="ts">
import type { ImageAsset, Message } from "../../../types/studio";
import Tooltip from "../../ui/Tooltip.vue";
import { durationLabel, imageDownloadName } from "./messageImageFormat";

const props = defineProps<{
  image?: ImageAsset;
  imageId: string;
  isAttached: boolean;
  message: Message;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  continueEdit: [id: string];
  generateAnother: [message: Message];
  previewImage: [id: string];
  refreshImage: [message: Message, imageId: string];
}>();

function attachActionLabel() {
  if (!props.image) return "不可引用";
  return props.isAttached ? "已引用" : "加入引用";
}
</script>

<template>
  <figure class="overflow-hidden rounded-xl border border-gray-200">
    <div
      class="group relative flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400"
    >
      <span
        v-if="image?.editSourceImageId"
        class="absolute left-2 top-2 z-10 rounded bg-black px-1.5 py-0.5 text-[11px] font-medium text-white"
      >
        已编辑
      </span>
      <button
        v-if="image?.previewUrl"
        class="h-full w-full cursor-pointer"
        type="button"
        @click="emit('previewImage', imageId)"
      >
        <img
          class="h-full w-full object-contain"
          :alt="image?.name"
          :src="image?.previewUrl"
        />
        <span
          class="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          点击查看
        </span>
      </button>
      <div
        v-else
        class="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-gray-300 bg-gray-50 px-4 text-center"
      >
        <span class="text-sm font-medium text-gray-500">图片已删除</span>
        <span class="text-xs text-gray-400">
          这张图片已从图片库移除，无法显示预览
        </span>
      </div>
    </div>
    <figcaption class="px-3 py-2">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center justify-between gap-3">
          <div class="truncate text-sm font-medium">
            {{ image?.name || "图片已删除" }}
          </div>
          <div class="shrink-0 text-xs text-gray-400">
            生成耗时：{{ durationLabel(image?.generationDurationMs) }}
          </div>
        </div>
        <div class="truncate text-xs text-gray-500">
          {{ image?.prompt || "原图片资产已从图片库中删除" }}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          class="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800"
          type="button"
          :disabled="!image"
          :class="!image ? 'cursor-not-allowed opacity-30 hover:bg-black' : ''"
          @click="emit('continueEdit', imageId)"
        >
          继续编辑
        </button>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip :text="attachActionLabel()" preferred-placement="top">
            <button
              :class="[
                'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                isAttached
                  ? 'bg-gray-100 text-gray-400'
                  : 'cursor-pointer text-gray-600 hover:bg-gray-100',
              ]"
              type="button"
              :disabled="!image"
              :aria-label="attachActionLabel()"
              @click="emit('attachImage', imageId)"
            >
              <svg
                v-if="isAttached"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <svg
                v-else
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="再次生成" preferred-placement="top">
            <button
              class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
              type="button"
              :disabled="!image"
              aria-label="再次生成"
              @click="emit('generateAnother', message)"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="刷新" preferred-placement="top">
            <button
              class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
              type="button"
              :disabled="!image"
              aria-label="刷新"
              @click="emit('refreshImage', message, imageId)"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M17 1l4 4-4 4" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <path d="M7 23l-4-4 4-4" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="下载" preferred-placement="top">
            <a
              v-if="image?.previewUrl"
              class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100"
              :download="imageDownloadName(image)"
              :href="image?.previewUrl"
              aria-label="下载"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
            </a>
          </Tooltip>
        </div>
      </div>
    </figcaption>
  </figure>
</template>
