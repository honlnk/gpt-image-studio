<script setup lang="ts">
import type { ConnectionMode } from "../../types/studio";

defineProps<{
  connectionMode: ConnectionMode;
  apiBaseUrl: string;
  apiKey: string;
}>();

const emit = defineEmits<{
  "update:connectionMode": [value: ConnectionMode];
  "update:apiBaseUrl": [value: string];
  "update:apiKey": [value: string];
}>();
</script>

<template>
  <section aria-labelledby="apiSettingsTitle">
    <h3
      id="apiSettingsTitle"
      class="text-base font-semibold text-gray-900"
    >
      接口
    </h3>
    <p class="mt-1 text-sm text-gray-500">
      当前设置会保存到浏览器本地 IndexedDB。
    </p>

    <div class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
      API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
    </div>

    <div class="mt-5 space-y-4">
      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">
          连接模式
        </p>
        <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            class="cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="
              connectionMode === 'direct'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            "
            type="button"
            @click="emit('update:connectionMode', 'direct')"
          >
            浏览器直连
          </button>
          <button
            class="cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="
              connectionMode === 'localCompanion'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            "
            type="button"
            @click="emit('update:connectionMode', 'localCompanion')"
          >
            本地 Companion
          </button>
        </div>
        <p
          v-if="connectionMode === 'localCompanion'"
          class="mt-2 text-xs text-amber-700"
        >
          本地 Companion 模式仍在预留阶段，暂未启用真实请求通路。
        </p>
      </div>

      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700"
          for="apiKey"
        >
          OpenAI API key
        </label>
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
        >
          API Base URL
        </label>
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
        >
          没有API Key？
        </a>
      </div>
    </div>
  </section>
</template>
