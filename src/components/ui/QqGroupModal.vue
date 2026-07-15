<script setup lang="ts">
import { QQ_GROUP_QR_URL } from "../../shared/community";

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-6"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <button
        class="absolute right-5 top-5 cursor-pointer rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        type="button"
        aria-label="关闭"
        @click="emit('close')"
      >
        <svg
          class="h-6 w-6"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
          />
        </svg>
      </button>

      <img
        :src="QQ_GROUP_QR_URL"
        alt="QQ 群二维码"
        class="max-h-[90vh] w-auto max-w-full rounded-lg shadow-2xl"
        @click="emit('close')"
      />
    </div>
  </Teleport>
</template>
