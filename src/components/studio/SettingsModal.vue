<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  isOpen: boolean;
  apiKey: string;
  apiBaseUrl: string;
}>();

const emit = defineEmits<{
  close: [];
  exportBackup: [];
  importBackup: [file: File];
  "update:apiKey": [value: string];
  "update:apiBaseUrl": [value: string];
}>();

const backupInputRef = ref<HTMLInputElement | null>(null);

function chooseBackupFile() {
  backupInputRef.value?.click();
}

function importBackupFromInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    emit("importBackup", file);
  }
  input.value = "";
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
      @click.self="emit('close')"
    >
      <section
        aria-labelledby="settingsTitle"
        aria-modal="true"
        class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
      >
        <div class="mb-5 flex items-start justify-between">
          <div>
            <h2 id="settingsTitle" class="text-lg font-semibold text-gray-900">
              接口设置
            </h2>
            <p class="mt-0.5 text-sm text-gray-500">
              当前设置会保存到浏览器本地 IndexedDB。
            </p>
          </div>
          <button
            class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭设置"
            type="button"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <div class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
        </div>

        <div class="space-y-4">
          <div>
            <label
              class="mb-1 block text-sm font-medium text-gray-700"
              for="apiKey"
              >OpenAI API key</label
            >
            <input
              id="apiKey"
              :value="apiKey"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
              autocomplete="off"
              placeholder="sk-..."
              type="password"
              @input="
                emit('update:apiKey', ($event.target as HTMLInputElement).value)
              "
            />
          </div>

          <div>
            <label
              class="mb-1 block text-sm font-medium text-gray-700"
              for="apiBaseUrl"
              >API Base URL</label
            >
            <input
              id="apiBaseUrl"
              :value="apiBaseUrl"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
              placeholder="https://api.openai.com/v1/images"
              type="url"
              @input="
                emit(
                  'update:apiBaseUrl',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
            <a
              href="https://code.mrzengchn.com/register?aff=HMvx"
              class="mt-1.5 inline-block cursor-pointer text-xs text-gray-400 transition-colors hover:text-gray-600"
              target="_blank"
              rel="noopener"
              >没有API Key？</a
            >
          </div>
        </div>

        <div class="mt-5 border-t border-gray-200 pt-5">
          <div class="mb-3">
            <h3 class="text-sm font-semibold text-gray-900">数据备份</h3>
            <p class="mt-0.5 text-xs leading-relaxed text-gray-500">
              导出会话、消息和图片；API key 不会写入备份。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              type="button"
              @click="emit('exportBackup')"
            >
              导出备份
            </button>
            <button
              class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
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
        </div>

        <div class="mt-6 flex justify-end">
          <button
            class="cursor-pointer rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            type="button"
            @click="emit('close')"
          >
            完成
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
