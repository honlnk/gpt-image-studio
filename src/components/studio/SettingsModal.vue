<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  apiKey: string;
  apiBaseUrl: string;
}>();

const emit = defineEmits<{
  close: [];
  "update:apiKey": [value: string];
  "update:apiBaseUrl": [value: string];
}>();
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
            <h2
              id="settingsTitle"
              class="text-lg font-semibold text-gray-900"
            >
              接口设置
            </h2>
            <p class="mt-0.5 text-sm text-gray-500">
              当前仍使用浏览器本地配置，后续会迁移到 IndexedDB 设置表。
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
              @input="emit('update:apiKey', ($event.target as HTMLInputElement).value)"
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
              type="url"
              @input="emit('update:apiBaseUrl', ($event.target as HTMLInputElement).value)"
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
