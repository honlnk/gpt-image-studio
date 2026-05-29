<script setup lang="ts">
import type { Message } from "../../../types/studio";
import Tooltip from "../../ui/Tooltip.vue";
import { messageErrorText } from "./messageImageFormat";

const props = defineProps<{
  message: Message;
}>();

const emit = defineEmits<{
  retryMessage: [message: Message];
}>();
</script>

<template>
  <figure
    class="overflow-hidden rounded-xl border border-red-100 bg-white"
    aria-label="图片生成失败"
  >
    <div
      class="flex h-48 flex-col items-center justify-center gap-3 bg-red-50/60 px-6 text-center"
    >
      <div
        class="flex h-11 w-11 items-center justify-center rounded-full border border-red-100 bg-white text-red-500 shadow-sm"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
      <div>
        <div class="text-sm font-medium text-red-700">生成中断</div>
        <Tooltip
          :text="messageErrorText(props.message)"
          preferred-placement="top"
          multiline
          :delay="1000"
          :hide-delay="500"
        >
          <div class="mt-1 line-clamp-2 text-xs leading-relaxed text-red-500">
            {{ messageErrorText(props.message) }}
          </div>
        </Tooltip>
      </div>
    </div>
    <figcaption class="px-3 py-2">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate text-sm font-medium">未生成图片</div>
          <Tooltip
            :text="messageErrorText(props.message)"
            preferred-placement="top"
            multiline
            :delay="1000"
            :hide-delay="500"
          >
            <div class="truncate text-xs text-gray-500">
              生成失败：{{ messageErrorText(props.message) }}
            </div>
          </Tooltip>
        </div>
        <button
          class="shrink-0 cursor-pointer rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
          type="button"
          @click="emit('retryMessage', props.message)"
        >
          重试
        </button>
      </div>
    </figcaption>
  </figure>
</template>
