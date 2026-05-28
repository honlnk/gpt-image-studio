<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import type { ConnectionMode } from "../../types/studio";
import {
  checkCompanionHealth,
  getCompanionAuthStatus,
  getCompanionAuthStatusResult,
  startPairing,
  confirmPairing,
  unpairCompanion,
} from "../../services/companionApi";
import type { CompanionAuthStatus, CompanionHealthResponse } from "../../types/companion";

const props = defineProps<{
  connectionMode: ConnectionMode;
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiKey: string;
  companionUrl: string;
  companionSessionToken: string;
  companionPaired: boolean;
}>();

const emit = defineEmits<{
  "update:connectionMode": [value: ConnectionMode];
  "update:apiBaseUrl": [value: string];
  "update:apiBaseUrlMode": [value: "origin" | "full"];
  "update:apiKey": [value: string];
  "update:companionSessionToken": [value: string];
}>();

const companionOnline = ref(false);
const companionHealth = ref<CompanionHealthResponse | null>(null);
const companionAuthStatus = ref<CompanionAuthStatus | null>(null);
const pairingInProgress = ref(false);
const pairingError = ref("");
const pairingCodeInput = ref("");
const apiKeyVisible = ref(false);
const apiKeyCopyStatus = ref<"idle" | "copied" | "failed">("idle");
let apiKeyCopyStatusTimer: ReturnType<typeof setTimeout> | undefined;

async function checkStatus() {
  const health = await checkCompanionHealth(props.companionUrl);
  companionHealth.value = health;
  companionOnline.value = health !== null;

  if (!health || !props.companionSessionToken) {
    companionAuthStatus.value = null;
    return;
  }

  if (!health.paired) {
    emit("update:companionSessionToken", "");
    companionAuthStatus.value = null;
    pairingInProgress.value = false;
    pairingCodeInput.value = "";
    pairingError.value = "检测到本地 Companion 配对已失效，已清除浏览器里的旧会话，请重新配对。";
    return;
  }

  const authResult = await getCompanionAuthStatusResult(
    props.companionUrl,
    props.companionSessionToken,
  );

  if (authResult.ok) {
    companionAuthStatus.value = authResult.status;
    return;
  }

  companionAuthStatus.value = null;
  if (authResult.invalidToken) {
    emit("update:companionSessionToken", "");
    pairingInProgress.value = false;
    pairingCodeInput.value = "";
    pairingError.value = "检测到本地 Companion 拒绝了旧 token，已清除浏览器会话，请重新配对。";
  }
}

async function handleStartPairing() {
  pairingError.value = "";
  pairingCodeInput.value = "";
  try {
    await startPairing(props.companionUrl);
    pairingInProgress.value = true;
  } catch (error) {
    pairingError.value = error instanceof Error
      ? error.message
      : "无法连接 Companion 服务";
  }
}

async function handleConfirmPairing() {
  pairingError.value = "";
  try {
    const result = await confirmPairing(props.companionUrl, pairingCodeInput.value);
    emit("update:companionSessionToken", result.sessionToken);
    pairingInProgress.value = false;
    companionAuthStatus.value = await getCompanionAuthStatus(props.companionUrl, result.sessionToken);
  } catch {
    pairingError.value = "配对码无效或已过期";
  }
}

async function handleDisconnect() {
  pairingError.value = "";
  const health = await checkCompanionHealth(props.companionUrl);
  companionHealth.value = health;
  companionOnline.value = health !== null;
  if (!health) {
    pairingError.value = "Companion 离线，无法确认断开连接。请先启动 Companion 后再断开。";
    return;
  }

  try {
    await unpairCompanion(props.companionUrl, props.companionSessionToken);
  } catch {
    pairingError.value = "断开失败，Companion 未确认清除本地 session。";
    return;
  }

  emit("update:companionSessionToken", "");
  companionAuthStatus.value = null;
  await checkStatus();
}

function cancelPairing() {
  pairingInProgress.value = false;
  pairingCodeInput.value = "";
  pairingError.value = "";
}

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

onMounted(() => {
  if (props.connectionMode === "localCompanion") {
    checkStatus();
  }
});

onUnmounted(() => {
  if (apiKeyCopyStatusTimer) {
    clearTimeout(apiKeyCopyStatusTimer);
  }
});

watch(
  () => props.connectionMode,
  (mode) => {
    if (mode === "localCompanion") checkStatus();
  },
);

watch(
  () => props.companionSessionToken,
  () => {
    if (props.connectionMode === "localCompanion") checkStatus();
  },
);
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
      </div>

      <!-- Direct mode -->
      <template v-if="connectionMode === 'direct'">
        <div class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
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
              :placeholder="apiBaseUrlMode === 'full' ? 'https://api.packyapi.com/v1/images' : 'https://api.packyapi.com'"
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
              /v1/images
            </span>
          </div>
          <a
            href="https://www.packyapi.com/register?aff=mUWS"
            class="mt-1.5 inline-block cursor-pointer text-xs text-gray-400 transition-colors hover:text-gray-600"
            target="_blank"
            rel="noopener"
          >
            没有API Key？
          </a>
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
              @click="checkStatus"
            >
              刷新
            </button>
          </div>

          <!-- Paired state -->
          <template v-if="companionPaired && !pairingInProgress">
            <div class="flex items-center justify-between">
              <span class="text-sm text-green-700">已配对</span>
              <button
                class="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                type="button"
                @click="handleDisconnect"
              >
                断开连接
              </button>
            </div>
          </template>

          <!-- Not paired, not in progress -->
          <template v-else-if="!pairingInProgress">
            <p class="text-sm text-gray-500">
              需要与本地 Companion 配对后才能使用。请先在终端运行 <span class="font-mono text-gray-700">gpt-image-studio pair</span>，再点击开始配对。
            </p>
            <p v-if="!companionOnline" class="text-xs text-gray-500">
              请先在终端启动 <span class="font-mono text-gray-700">gpt-image-studio start</span>，然后点击刷新。
            </p>
            <button
              class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
              type="button"
              :disabled="!companionOnline"
              @click="handleStartPairing"
            >
              开始配对
            </button>
          </template>

          <!-- Pairing in progress -->
          <template v-if="pairingInProgress">
            <p class="text-sm text-gray-600">
              请在 Companion 终端查看配对码，然后在下方输入。
            </p>
            <div class="flex gap-2">
              <input
                v-model="pairingCodeInput"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-center tracking-widest text-gray-900 outline-none focus:border-gray-500"
                placeholder="输入 6 位配对码"
                maxlength="6"
                inputmode="numeric"
              />
              <button
                class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
                type="button"
                :disabled="pairingCodeInput.length !== 6"
                @click="handleConfirmPairing"
              >
                确认
              </button>
              <button
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
                type="button"
                @click="cancelPairing"
              >
                取消
              </button>
            </div>
          </template>

          <!-- Error -->
          <p v-if="pairingError" class="text-xs text-red-600">
            {{ pairingError }}
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
