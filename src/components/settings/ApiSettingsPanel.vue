<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import type { ApiMode, ConnectionMode } from "../../types/studio";
import { FIXED_IMAGE_MODEL } from "../../shared/models";

const props = defineProps<{
  connectionMode: ConnectionMode;
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiMode: ApiMode;
  apiKey: string;
  model: string;
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
}>();

const emit = defineEmits<{
  "update:connectionMode": [value: ConnectionMode];
  "update:apiBaseUrl": [value: string];
  "update:apiBaseUrlMode": [value: "origin" | "full"];
  "update:apiMode": [value: ApiMode];
  "update:apiKey": [value: string];
  "update:model": [value: string];
  "update:streamImages": [value: boolean];
  "update:streamPartialImages": [value: 0 | 1 | 2 | 3];
}>();

const apiKeyVisible = ref(false);
const apiKeyCopyStatus = ref<"idle" | "copied" | "failed">("idle");
let apiKeyCopyStatusTimer: ReturnType<typeof setTimeout> | undefined;

const apiModeOptions: Array<{ value: ApiMode; label: string; description: string }> = [
  { value: "images", label: "Images API", description: "直接调用 /v1/images，兼容传统图片接口。" },
  { value: "responses", label: "Responses API", description: "通过 /v1/responses 调用 image_generation 工具。" },
];
const partialImageOptions = [0, 1, 2, 3] as const;
const apiBaseUrlHint = computed(() =>
  props.apiBaseUrlMode === "full"
    ? props.apiMode === "responses"
      ? "https://api.example.com/v1"
      : "https://api.example.com/v1/images"
    : "https://api.example.com",
);
const apiSuffixLabel = computed(() =>
  props.apiMode === "responses" ? "/v1" : "/v1/images",
);

function normalizeApiBaseUrlInput(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function resetApiKeyCopyStatusSoon() {
  if (apiKeyCopyStatusTimer) {
    clearTimeout(apiKeyCopyStatusTimer);
  }
  apiKeyCopyStatusTimer = setTimeout(() => {
    apiKeyCopyStatus.value = "idle";
  }, 1600);
}

function toggleApiKeyVisibility() {
  apiKeyVisible.value = !apiKeyVisible.value;
  apiKeyCopyStatus.value = "idle";
}

async function copyApiKey() {
  if (!apiKeyVisible.value || !props.apiKey) return;

  try {
    await navigator.clipboard.writeText(props.apiKey);
    apiKeyCopyStatus.value = "copied";
  } catch {
    apiKeyCopyStatus.value = "failed";
  }

  resetApiKeyCopyStatusSoon();
}

onUnmounted(() => {
  if (apiKeyCopyStatusTimer) {
    clearTimeout(apiKeyCopyStatusTimer);
  }
});
</script>

<template>
  <section aria-labelledby="apiSettingsTitle">
    <h3 id="apiSettingsTitle" class="text-base font-semibold text-gray-900">
      接口
    </h3>
    <p class="mt-1 text-sm text-gray-500">
      当前设置会保存到浏览器本地 IndexedDB。
    </p>

    <div class="mt-5 space-y-4">
      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">连接模式</p>
        <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'direct' } }"
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
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'localCompanion' } }"
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
      </div>

      <!-- Companion mode：说明 + 迁移指引 + 管理入口 -->
      <div v-if="connectionMode === 'localCompanion'" class="space-y-3">
        <div class="rounded-lg bg-gray-50 p-4 space-y-2 text-sm text-gray-600">
          <p class="font-medium text-gray-800">本地 Companion 服务</p>
          <p class="text-xs leading-relaxed">
            Companion 是一个运行在本机的轻量代理服务，负责将浏览器请求转发给你配置的 AI 图片生成接口。
            现已支持多套 provider 配置，可在管理页中自由增删切换。
          </p>
        </div>

        <!-- v0.6 重构迁移提示 -->
        <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <p class="text-sm font-medium text-amber-800">⚙️ 升级提示</p>
          <p class="text-xs leading-relaxed text-amber-700">
            Companion 凭据存储结构已重构，不再兼容旧版本。如果你之前使用过 Companion，请：
          </p>
          <ol class="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-amber-700">
            <li>更新 Companion：<span class="font-mono text-amber-900">npm install -g @honlnk/image-studio-companion@latest</span></li>
            <li>删除旧配置：<span class="font-mono text-amber-900">rm ~/.gpt-image-studio/credentials.json</span></li>
            <li>前往管理页重新添加 provider 配置</li>
          </ol>
        </div>

        <div class="flex items-center justify-between rounded-lg border border-gray-200 p-3">
          <div class="text-xs text-gray-500">
            配置管理（增删改、切换激活、查看日志）已移至独立页面
          </div>
          <a
            href="/companion"
            class="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
          >
            打开管理页 →
          </a>
        </div>
      </div>

      <!-- Direct mode -->
      <template v-if="connectionMode === 'direct'">
        <div class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
        </div>

        <div>
          <p class="mb-2 block text-sm font-medium text-gray-700">接口模式</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="option in apiModeOptions"
              :key="option.value"
              class="cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors"
              :class="
                apiMode === option.value
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              "
              type="button"
              @click="emit('update:apiMode', option.value)"
            >
              <div class="text-sm font-semibold">{{ option.label }}</div>
              <div
                class="mt-1 text-xs"
                :class="apiMode === option.value ? 'text-gray-200' : 'text-gray-500'"
              >
                {{ option.description }}
              </div>
            </button>
          </div>
        </div>

        <div>
          <label
            class="mb-1 block text-sm font-medium text-gray-700"
            for="apiKey"
          >
            OpenAI API key
          </label>
          <div class="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-500">
            <input
              id="apiKey"
              :value="apiKey"
              class="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-gray-900 outline-none"
              autocomplete="off"
              placeholder="sk-..."
              :type="apiKeyVisible ? 'text' : 'password'"
              @input="
                emit('update:apiKey', ($event.target as HTMLInputElement).value)
              "
            />
            <button
              class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
              type="button"
              :aria-label="apiKeyVisible ? '隐藏 API key' : '显示 API key'"
              :title="apiKeyVisible ? '隐藏 API key' : '显示 API key'"
              @click="toggleApiKeyVisibility"
            >
              <svg
                v-if="apiKeyVisible"
                aria-hidden="true"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg
                v-else
                aria-hidden="true"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="m3 3 18 18" />
                <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                <path d="M9.88 4.24A10.38 10.38 0 0 1 12 4c7 0 10 8 10 8a15.51 15.51 0 0 1-2.45 3.67" />
                <path d="M6.61 6.61A15.8 15.8 0 0 0 2 12s3 8 10 8a10.4 10.4 0 0 0 5.39-1.61" />
              </svg>
            </button>
            <button
              v-if="apiKeyVisible"
              class="flex h-10 shrink-0 cursor-pointer items-center justify-center border-l border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
              type="button"
              :disabled="!apiKey"
              :aria-label="apiKeyCopyStatus === 'copied' ? 'API key 已复制' : '复制 API key'"
              :title="apiKeyCopyStatus === 'copied' ? '已复制' : '复制 API key'"
              @click="copyApiKey"
            >
              {{ apiKeyCopyStatus === "copied" ? "已复制" : "复制" }}
            </button>
          </div>
          <p
            v-if="apiKeyCopyStatus === 'failed'"
            class="mt-1.5 text-xs text-red-500"
          >
            复制失败，请手动选择复制。
          </p>
        </div>

        <div>
          <label
            class="mb-1 block text-sm font-medium text-gray-700"
            for="apiModel"
          >
            模型
          </label>
          <input
            id="apiModel"
            :value="model"
            class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none"
            :placeholder="FIXED_IMAGE_MODEL"
            disabled
            readonly
            spellcheck="false"
            type="text"
          />
          <p class="mt-1.5 text-xs text-gray-500">
            当前阶段固定使用 <span class="font-mono">{{ FIXED_IMAGE_MODEL }}</span>，先不开放自定义模型输入。
          </p>
        </div>

        <div>
          <div class="mb-1 flex items-center justify-between gap-3">
            <label
              class="block text-sm font-medium text-gray-700"
              for="apiBaseUrl"
            >
              API 地址
            </label>
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
              <input
                class="h-3.5 w-3.5 cursor-pointer accent-gray-900"
                type="checkbox"
                :checked="apiBaseUrlMode === 'full'"
                @change="
                  emit(
                    'update:apiBaseUrlMode',
                    ($event.target as HTMLInputElement).checked ? 'full' : 'origin',
                  )
                "
              />
              输入完整 API Base URL
            </label>
          </div>
          <div class="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-500">
            <input
              id="apiBaseUrl"
              :value="apiBaseUrl"
              class="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-gray-900 outline-none"
              :placeholder="apiBaseUrlHint"
              type="url"
              @input="
                emit(
                  'update:apiBaseUrl',
                  ($event.target as HTMLInputElement).value,
                )
              "
              @blur="
                emit(
                  'update:apiBaseUrl',
                  normalizeApiBaseUrlInput(($event.target as HTMLInputElement).value),
                )
              "
            />
            <span
              v-if="apiBaseUrlMode === 'origin'"
              class="flex shrink-0 items-center border-l border-gray-200 px-3 text-sm font-medium text-red-500"
            >
              {{ apiSuffixLabel }}
            </span>
          </div>
          <p class="mt-1.5 text-xs text-gray-500">
            <template v-if="apiBaseUrlMode === 'origin'">
              输入站点根地址即可，应用会自动补上 {{ apiSuffixLabel }}。
            </template>
            <template v-else>
              已按完整 API Base URL 处理，不会自动补路径。
            </template>
          </p>
        </div>

        <div class="rounded-xl border border-gray-200 p-4">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              class="mt-0.5 h-4 w-4 cursor-pointer accent-gray-900"
              type="checkbox"
              :checked="streamImages"
              @change="
                emit(
                  'update:streamImages',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-gray-700">流式预览</span>
              <span class="mt-1 block text-xs text-gray-500">
                生成过程中接收中间图像，优先用于减少长时间等待时的空白状态。
              </span>
            </span>
          </label>

          <div class="mt-4">
            <label
              class="mb-1 block text-sm font-medium text-gray-700"
              for="streamPartialImages"
            >
              中间图数量
            </label>
            <select
              id="streamPartialImages"
              :value="streamPartialImages"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              :disabled="!streamImages"
              @change="
                emit(
                  'update:streamPartialImages',
                  Number(($event.target as HTMLSelectElement).value) as 0 | 1 | 2 | 3,
                )
              "
            >
              <option v-for="count in partialImageOptions" :key="count" :value="count">
                {{ count }}
              </option>
            </select>
            <p class="mt-1.5 text-xs text-gray-500">
              建议保留默认值 1。设置为 0 时仍可开启流式，但不会请求中间图。
            </p>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
