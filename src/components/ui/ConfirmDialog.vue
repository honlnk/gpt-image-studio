<script setup lang="ts">
import BaseModal from "./BaseModal.vue";

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default";
};

defineProps<{
  dialog: ConfirmDialogState | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <BaseModal
    :is-open="Boolean(dialog)"
    aria-labelledby="confirmDialogTitle"
    @close="emit('cancel')"
  >
    <div class="mb-5">
      <h2
        id="confirmDialogTitle"
        class="text-base font-semibold text-gray-900"
      >
        {{ dialog!.title }}
      </h2>
      <p class="mt-1 text-sm leading-relaxed text-gray-500">
        {{ dialog!.description }}
      </p>
    </div>

    <div class="flex justify-end gap-2">
      <button
        class="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        type="button"
        @click="emit('cancel')"
      >
        取消
      </button>
      <button
        class="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
        :class="
          dialog!.tone === 'danger'
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-black hover:bg-gray-800'
        "
        type="button"
        @click="emit('confirm')"
      >
        {{ dialog!.confirmLabel }}
      </button>
    </div>
  </BaseModal>
</template>
