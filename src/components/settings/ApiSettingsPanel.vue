<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import type { ApiMode, ConnectionMode } from "../../types/studio";
import { FIXED_IMAGE_MODEL } from "../../shared/models";
import type { CompanionAuthStatus, CompanionHealthResponse } from "../../types/companion";

const props = defineProps<{
  connectionMode: ConnectionMode;
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiMode: ApiMode;
  apiKey: string;
  model: string;
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
  companionUrl: string;
  companionSessionToken: string;
  companionPaired: boolean;
  // Companion 连接状态：由 useCompanionConnection（全局唯一来源）透传，本面板只做展示。
  companionOnline: boolean;
  companionHealth: CompanionHealthResponse | null;
  companionAuthStatus: CompanionAuthStatus | null;
  companionPairingInProgress: boolean;
  companionPairingError: string;
  // v-model:companionPairingCodeInput —— 配对码输入框双向绑定。
  companionPairingCodeInput: string;
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
  "update:companionSessionToken": [value: string];
  "update:companionPairingCodeInput": [value: string];
  // 连接操作委托给 view model 调用 useCompanionConnection。
  "check-status": [];
  "start-pairing": [];
  "confirm-pairing": [];
  "disconnect-companion": [];
  "cancel-pairing": [];
}>();

const apiKeyVisible = ref(false);
const apiKeyCopyStatus = ref<"idle" | "copied" | "failed">("idle");
let apiKeyCopyStatusTimer: ReturnType<typeof setTimeout> | undefined;

const isManagedCompanion = computed(() => props.companionHealth?.runMode !== "serve");
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

      <!-- Local Companion mode -->
      <template v-if="connectionMode === 'localCompanion'">
        <div class="rounded-lg border border-gray-200 p-4 space-y-3">
          <div class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <div class="font-mono text-gray-800">npm install -g @honlnk/image-studio-companion</div>
            <div class="mt-1 font-mono text-gray-800">gpt-image-studio login</div>
            <div class="mt-1 font-mono text-gray-800">gpt-image-studio start</div>
            <div class="mt-1 font-mono text-gray-800">gpt-image-studio pair</div>
          </div>

          <div class="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            本地 Companion 当前仅支持 Images API。若要使用 Responses API 或流式预览，请先切回浏览器直连模式。
          </div>

          <!-- Status -->
          <div class="flex items-center gap-2">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="companionOnline ? 'bg-green-500' : 'bg-gray-300'"
            />
            <span class="text-sm text-gray-700">
              {{ companionOnline ? "Companion 在线" : "Companion 离线" }}
            </span>
            <span v-if="companionHealth" class="text-xs text-gray-400">
              v{{ companionHealth.version }}
            </span>
            <button
              class="ml-auto text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
              type="button"
              @click="emit('check-status')"
            >
              刷新
            </button>
          </div>

          <!-- Paired state -->
          <template v-if="companionPaired && !companionPairingInProgress">
            <div class="flex items-center justify-between">
              <span class="text-sm text-green-700">已配对</span>
              <button
                class="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                type="button"
                @click="emit('disconnect-companion')"
              >
                断开连接
              </button>
            </div>
          </template>

          <!-- Not paired, not in progress -->
          <template v-else-if="!companionPairingInProgress">
            <p class="text-sm text-gray-500">
              <template v-if="isManagedCompanion">
                需要与本地 Companion 配对后才能使用。请先在终端运行 <span class="font-mono text-gray-700">gpt-image-studio pair</span>，再点击开始配对。
              </template>
              <template v-else>
                需要与本地 Companion 配对后才能使用。点击开始配对后，请在当前 Companion 终端查看配对码。
              </template>
            </p>
            <p v-if="!companionOnline" class="text-xs text-gray-500">
              请先在终端启动 <span class="font-mono text-gray-700">gpt-image-studio start</span>，然后点击刷新。
            </p>
            <button
              class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
              type="button"
              :disabled="!companionOnline"
              @click="emit('start-pairing')"
            >
              开始配对
            </button>
          </template>

          <!-- Pairing in progress -->
          <template v-if="companionPairingInProgress">
            <p class="text-sm text-gray-600">
              请在 Companion 终端查看配对码，然后在下方输入。
            </p>
            <div class="flex gap-2">
              <input
                :value="companionPairingCodeInput"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-center tracking-widest text-gray-900 outline-none focus:border-gray-500"
                placeholder="输入 6 位配对码"
                maxlength="6"
                inputmode="numeric"
                @input="emit('update:companionPairingCodeInput', ($event.target as HTMLInputElement).value)"
              />
              <button
                class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
                type="button"
                :disabled="companionPairingCodeInput.length !== 6"
                @click="emit('confirm-pairing')"
              >
                确认
              </button>
              <button
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
                type="button"
                @click="emit('cancel-pairing')"
              >
                取消
              </button>
            </div>
          </template>

          <!-- Error -->
          <p v-if="companionPairingError" class="text-xs text-red-600">
            {{ companionPairingError }}
            <template v-if="isManagedCompanion && companionPairingError.includes('gpt-image-studio pair')">
              ；请确认 pair 命令仍在等待中，然后再点击开始配对。
            </template>
          </p>

          <div v-if="companionPaired && companionOnline" class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <template v-if="companionAuthStatus">
              <span :class="companionAuthStatus.ready ? 'text-green-700' : 'text-amber-700'">
                {{ companionAuthStatus.ready ? "凭据已配置" : "凭据未配置" }}
              </span>
              <span v-if="companionAuthStatus.accountLabel">
                ：{{ companionAuthStatus.accountLabel }}
              </span>
            </template>
            <template v-else>
              已配对，但暂时无法读取凭据状态。请确认服务仍在运行。
            </template>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
