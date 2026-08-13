<script setup lang="ts">
import type { StudioNoticeType } from "../../stores/feedbackStore";

type NoticeToastState = {
  type: StudioNoticeType;
  message: string;
};

defineProps<{
  notice: NoticeToastState | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const VARIANT_STYLES: Record<
  StudioNoticeType,
  { box: string; badge: string }
> = {
  success: {
    box: "border-gray-200 text-gray-800",
    badge: "bg-gray-900 text-white",
  },
  error: {
    box: "border-red-200 text-red-700",
    badge: "bg-red-100 text-red-600",
  },
  info: {
    box: "border-blue-200 text-blue-700",
    badge: "bg-blue-100 text-blue-600",
  },
  warning: {
    box: "border-amber-200 text-amber-700",
    badge: "bg-amber-100 text-amber-600",
  },
};
</script>

<template>
  <div
    v-if="notice"
    class="fixed bottom-4 right-4 z-70 max-w-sm rounded-lg border bg-white px-4 py-3 text-sm shadow-xl"
    :class="VARIANT_STYLES[notice.type].box"
    role="status"
  >
    <div class="flex items-center gap-3">
      <div
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        :class="VARIANT_STYLES[notice.type].badge"
        aria-hidden="true"
      >
        <!-- error: x-circle -->
        <svg
          v-if="notice.type === 'error'"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
            clip-rule="evenodd"
          />
        </svg>
        <!-- success: check -->
        <svg
          v-else-if="notice.type === 'success'"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42 0L3.29 9.224a1 1 0 1 1 1.42-1.408l4.04 4.074 6.54-6.594a1 1 0 0 1 1.414-.006z"
            clip-rule="evenodd"
          />
        </svg>
        <!-- info: i-circle -->
        <svg
          v-else-if="notice.type === 'info'"
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 1 1h1a1 1 0 1 0 0-2v-3a1 1 0 0 0-1-1H9Z"
            clip-rule="evenodd"
          />
        </svg>
        <!-- warning: triangle exclamation -->
        <svg
          v-else
          class="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
      <p class="min-w-0 flex-1 leading-relaxed">
        {{ notice.message }}
      </p>
      <button
        class="cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        aria-label="关闭提示"
        type="button"
        @click="emit('close')"
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
</template>
