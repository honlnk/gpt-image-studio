<script setup lang="ts">
type NoticeToastState = {
  type: "success" | "error";
  message: string;
};

defineProps<{
  notice: NoticeToastState | null;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div
    v-if="notice"
    class="fixed bottom-4 right-4 z-70 max-w-sm rounded-lg border bg-white px-4 py-3 text-sm shadow-xl"
    :class="
      notice.type === 'error'
        ? 'border-red-200 text-red-700'
        : 'border-gray-200 text-gray-800'
    "
    role="status"
  >
    <div class="flex items-start gap-3">
      <div
        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        :class="
          notice.type === 'error'
            ? 'bg-red-100 text-red-600'
            : 'bg-gray-900 text-white'
        "
        aria-hidden="true"
      >
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
        <svg
          v-else
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
