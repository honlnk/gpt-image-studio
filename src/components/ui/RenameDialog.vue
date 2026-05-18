<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  isOpen: boolean;
  title: string;
  description: string;
  initialValue: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [value: string];
}>();

const inputValue = ref("");
const normalizedValue = computed(() => inputValue.value.trim());
const canConfirm = computed(() => Boolean(normalizedValue.value));

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    inputValue.value = props.initialValue;
  },
);

function confirm() {
  if (!canConfirm.value) return;
  emit("confirm", normalizedValue.value);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4"
      role="presentation"
      @mousedown.self="emit('cancel')"
    >
      <section
        aria-labelledby="renameDialogTitle"
        aria-modal="true"
        class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        role="dialog"
      >
        <div class="mb-4">
          <h2
            id="renameDialogTitle"
            class="text-base font-semibold text-gray-900"
          >
            {{ title }}
          </h2>
          <p class="mt-1 text-sm leading-relaxed text-gray-500">
            {{ description }}
          </p>
        </div>

        <input
          v-model="inputValue"
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
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
            class="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
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
