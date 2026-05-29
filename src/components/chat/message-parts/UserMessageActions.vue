<script setup lang="ts">
import type { Message } from "../../../types/studio";
import Tooltip from "../../ui/Tooltip.vue";

defineProps<{
  message: Message;
}>();

const emit = defineEmits<{
  copyText: [text: string];
  loadMessageConfig: [message: Message];
}>();
</script>

<template>
  <div
    class="absolute right-5 top-full z-10 mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100"
  >
    <Tooltip text="复制文本" preferred-placement="top">
      <button
        class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label="复制文本"
        type="button"
        @click="emit('copyText', message.content)"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </Tooltip>
    <Tooltip text="加载到输入面板" preferred-placement="top">
      <button
        class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label="加载到输入面板"
        type="button"
        @click="emit('loadMessageConfig', message)"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6h9" />
          <path d="M17 6h3" />
          <circle cx="15" cy="6" r="2" />
          <path d="M4 12h3" />
          <path d="M11 12h9" />
          <circle cx="9" cy="12" r="2" />
          <path d="M4 18h11" />
          <path d="M19 18h1" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      </button>
    </Tooltip>
  </div>
</template>
