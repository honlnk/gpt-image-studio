<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  isOpen: boolean;
  title: string;
  description: string;
  confirmText: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const inputValue = ref("");
const canConfirm = computed(() => inputValue.value === props.confirmText);

watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      inputValue.value = "";
    }
  },
);

function confirm() {
  if (!canConfirm.value) return;
  emit("confirm");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4"
      role="presentation"
      @click.self="emit('cancel')"
    >
      <section
        aria-labelledby="confirmInputTitle"
        aria-modal="true"
        class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        role="dialog"
      >
        <div class="mb-4">
          <h2
            id="confirmInputTitle"
            class="text-base font-semibold text-gray-900"
          >
            {{ title }}
          </h2>
          <div class="mt-1 text-sm leading-relaxed text-gray-500">
            <slot name="description">{{ description }}</slot>
          </div>
        </div>

        <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p class="text-xs text-gray-500">请输入以下文字确认：</p>
          <p class="mt-1 select-all text-sm font-medium text-gray-900">
            {{ confirmText }}
          </p>
        </div>

        <input
          v-model="inputValue"
          class="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
          autocomplete="off"
          type="text"
          @keydown.enter="confirm"
        />

        <div class="mt-5 flex justify-end gap-2">
          <button
            class="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            type="button"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            :disabled="!canConfirm"
            type="button"
            @click="confirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
