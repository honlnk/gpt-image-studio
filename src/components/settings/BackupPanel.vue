<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  exportBackup: [];
  importBackupRequest: [file: File];
}>();

const backupInputRef = ref<HTMLInputElement | null>(null);

function chooseBackupFile() {
  backupInputRef.value?.click();
}

function importBackupFromInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    emit("importBackupRequest", file);
  }
  input.value = "";
}
</script>

<template>
  <section aria-labelledby="backupSettingsTitle">
    <h3
      id="backupSettingsTitle"
      class="text-base font-semibold text-gray-900"
    >
      数据备份
    </h3>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      导出会话、消息和图片；API key
      不会写入备份。恢复备份会覆盖当前浏览器里的本地数据。
    </p>

    <div class="mt-5 flex flex-wrap gap-2">
      <button
        class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        type="button"
        @click="emit('exportBackup')"
      >
        导出备份
      </button>
      <button
        class="cursor-pointer rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        type="button"
        @click="chooseBackupFile"
      >
        恢复备份
      </button>
      <input
        ref="backupInputRef"
        class="sr-only"
        type="file"
        accept=".zip,application/zip"
        @change="importBackupFromInput"
      />
    </div>
  </section>
</template>
