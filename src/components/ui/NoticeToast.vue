<script setup lang="ts">
import type { StudioNoticeType } from "../../stores/feedbackStore";

type NoticeToastState = {
  type: StudioNoticeType;
  message: string;
};

defineProps<{
  notice: NoticeToastState | null;
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
    box: "border-red-100 text-red-700",
    badge: "bg-red-50 text-red-500",
  },
  info: {
    box: "border-blue-100 text-blue-700",
    badge: "bg-blue-50 text-blue-500",
  },
  warning: {
    box: "border-amber-100 text-amber-700",
    badge: "bg-amber-50 text-amber-500",
  },
};
</script>

<template>
  <!-- 底部轻提示：非阻断反馈（成功确认/常规提醒），短时自动消失，不设关闭按钮 -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-3 opacity-0"
  >
    <div
      v-if="notice"
      class="pointer-events-none fixed inset-x-0 bottom-4 z-70 flex justify-center px-4"
      role="status"
    >
      <div
        class="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border bg-white px-4 py-2 text-sm shadow-lg"
        :class="VARIANT_STYLES[notice.type].box"
      >
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="VARIANT_STYLES[notice.type].badge"
          aria-hidden="true"
        >
          <!-- error: x-circle -->
          <svg
            v-if="notice.type === 'error'"
            class="h-3 w-3"
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
            class="h-3 w-3"
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
            class="h-3 w-3"
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
            class="h-3 w-3"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clip-rule="evenodd"
            />
          </svg>
        </span>
        <p class="min-w-0 leading-relaxed">
          {{ notice.message }}
        </p>
      </div>
    </div>
  </Transition>
</template>
