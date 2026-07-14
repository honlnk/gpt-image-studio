<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  CompanionAuthStatus,
  CompanionCredentialsView,
  CompanionHealthResponse,
  CompanionLogsTailResponse,
  CompanionProviderPreset,
} from "../../types/companion";

const props = defineProps<{
  // 连接状态（透传自 useCompanionConnection，复用现有配对逻辑）。
  companionUrl: string;
  companionSessionToken: string;
  companionPaired: boolean;
  companionOnline: boolean;
  companionHealth: CompanionHealthResponse | null;
  companionAuthStatus: CompanionAuthStatus | null;
  companionPairingInProgress: boolean;
  companionPairingError: string;
  companionPairingCodeInput: string;
  // 凭证 + 日志（来自 useCompanionManagement）。
  presets: CompanionProviderPreset[];
  credentials: CompanionCredentialsView | null;
  logs: CompanionLogsTailResponse | null;
  loadingPresets: boolean;
  loadingCredentials: boolean;
  savingCredentials: boolean;
  logsLoading: boolean;
  credError: string;
  logsError: string;
}>();

const emit = defineEmits<{
  "update:companionPairingCodeInput": [value: string];
  "check-status": [];
  "start-pairing": [];
  "confirm-pairing": [];
  "disconnect-companion": [];
  "cancel-pairing": [];
  // 凭证 + 日志管理动作。
  "load-presets": [];
  "load-credentials": [];
  "submit-credentials": [form: { provider?: string; apiBaseUrl: string; apiKey: string; model?: string }];
  "remove-credentials": [];
  "load-logs": [params: { lines?: number; date?: string }];
}>();

const isManagedCompanion = computed(
  () => props.companionHealth?.runMode !== "serve",
);

// ---- 凭证表单本地态 ----
const formProvider = ref("");
const formBaseUrl = ref("");
const formModel = ref("");
const formApiKey = ref("");
// 是否处于"编辑/新增"模式（未配置凭据时默认进入；已配置时点"修改"才进入）。
const editingCredentials = ref(false);

function applyPresetDefaults() {
  const preset = props.presets.find((p) => p.id === formProvider.value);
  if (!preset) return;
  // 仅在字段为空时填默认值，避免覆盖用户已输入内容。
  if (!formBaseUrl.value) formBaseUrl.value = preset.defaultBaseUrl;
  if (!formModel.value) formModel.value = preset.defaultModel;
}

function onProviderChange() {
  // 切 provider 时强制刷新默认值（用户体验：选了 provider 就用它的默认）。
  const preset = props.presets.find((p) => p.id === formProvider.value);
  if (preset) {
    formBaseUrl.value = preset.defaultBaseUrl;
    formModel.value = preset.defaultModel;
  }
}

function startEdit() {
  // 进入编辑态：用当前已配置的值预填（provider/baseUrl/model），apiKey 留空要求重输。
  const cred = props.credentials;
  formProvider.value = cred?.provider ?? props.presets[0]?.id ?? "";
  formBaseUrl.value = cred?.apiBaseUrl ?? "";
  formModel.value = cred?.model ?? "";
  formApiKey.value = "";
  applyPresetDefaults();
  editingCredentials.value = true;
}

function cancelEdit() {
  editingCredentials.value = false;
  formApiKey.value = "";
}

function submit() {
  emit("submit-credentials", {
    provider: formProvider.value || undefined,
    apiBaseUrl: formBaseUrl.value.trim(),
    apiKey: formApiKey.value.trim(),
    model: formModel.value.trim() || undefined,
  });
  // 保存后清空内存里的 key 输入；保存成功由父级刷新 credentials prop。
  formApiKey.value = "";
  editingCredentials.value = false;
}

// 已配置凭据或 presets 加载后，同步表单默认 provider（供首次填写的占位）。
watch(
  () => [props.credentials, props.presets] as const,
  () => {
    if (!formProvider.value) {
      formProvider.value = props.credentials?.provider ?? props.presets[0]?.id ?? "";
    }
    if (!editingCredentials.value) {
      // 非编辑态：同步展示用的 baseUrl/model（只读模式下显示）。
      formBaseUrl.value = props.credentials?.apiBaseUrl ?? "";
      formModel.value = props.credentials?.model ?? "";
    }
  },
  { immediate: true },
);

// ---- 日志 ----
const logDate = ref(todayStr());
const logLines = ref(100);

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function refreshLogs() {
  emit("load-logs", { lines: logLines.value, date: logDate.value });
}

// online 变为 true 时，懒加载 presets + credentials（面板首次连上才拉）。
watch(
  () => props.companionOnline,
  (online) => {
    if (online) {
      emit("load-presets");
      emit("load-credentials");
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.companionOnline) {
    emit("load-presets");
    emit("load-credentials");
  }
});
</script>

<template>
  <section aria-labelledby="companionPanelTitle" class="space-y-6">
    <div>
      <h3 id="companionPanelTitle" class="text-base font-semibold text-gray-900">Companion</h3>
      <p class="mt-1 text-xs leading-relaxed text-gray-500">
        管理本地 Companion 服务：状态、配对、API 凭据与日志。和命令行工具完全等价，在线时可直接在此操作。
      </p>
    </div>

    <!-- ① 状态总览（离线时只显示这一块） -->
    <div class="rounded-lg border border-gray-200 p-4 space-y-3">
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="companionOnline ? 'bg-green-500' : 'bg-gray-300'"
        />
        <span class="text-sm text-gray-700">
          {{ companionOnline ? "Companion 在线" : "Companion 离线" }}
        </span>
        <span v-if="companionHealth" class="text-xs text-gray-400">
          v{{ companionHealth.version }} · {{ companionHealth.runMode === "managed" ? "后台托管" : "前台服务" }}
        </span>
        <button
          class="ml-auto text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
          type="button"
          @click="emit('check-status')"
        >
          刷新
        </button>
      </div>

      <template v-if="!companionOnline">
        <p class="text-xs text-gray-500">
          请先在终端启动 Companion 服务，然后点击"刷新"：
        </p>
        <div class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <div class="font-mono text-gray-800">npm install -g @honlnk/image-studio-companion</div>
          <div class="font-mono text-gray-800">gpt-image-studio login</div>
          <div class="font-mono text-gray-800">gpt-image-studio start</div>
        </div>
      </template>

      <template v-else>
        <!-- 在线时的凭据状态摘要 -->
        <div v-if="companionAuthStatus" class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <span :class="companionAuthStatus.ready ? 'text-green-700' : 'text-amber-700'">
            {{ companionAuthStatus.ready ? "凭据已配置" : "凭据未配置" }}
          </span>
          <template v-if="companionAuthStatus.ready">
            <span class="text-gray-500"> · {{ companionAuthStatus.provider }}</span>
            <span v-if="companionAuthStatus.model" class="text-gray-500"> · {{ companionAuthStatus.model }}</span>
            <span v-if="companionAuthStatus.accountLabel" class="text-gray-500"> · {{ companionAuthStatus.accountLabel }}</span>
          </template>
        </div>
      </template>
    </div>

    <!-- ② 配对管理（仅在线） -->
    <div v-if="companionOnline" class="rounded-lg border border-gray-200 p-4 space-y-3">
      <h4 class="text-sm font-medium text-gray-700">配对</h4>

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

      <template v-else-if="!companionPairingInProgress">
        <p class="text-sm text-gray-500">
          <template v-if="isManagedCompanion">
            后台托管模式下，请先在终端运行 <span class="font-mono text-gray-700">gpt-image-studio pair</span>，再点击开始配对。
          </template>
          <template v-else>
            点击开始配对后，请在当前 Companion 终端查看配对码。
          </template>
        </p>
        <button
          class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
          type="button"
          @click="emit('start-pairing')"
        >
          开始配对
        </button>
      </template>

      <template v-if="companionPairingInProgress">
        <p class="text-sm text-gray-600">请在 Companion 终端查看配对码，然后在下方输入。</p>
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

      <p v-if="companionPairingError" class="text-xs text-red-600">{{ companionPairingError }}</p>
    </div>

    <!-- ③ 凭证管理（仅在线） -->
    <div v-if="companionOnline" class="rounded-lg border border-gray-200 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium text-gray-700">API 凭据</h4>
        <button
          v-if="credentials?.hasApiKey && !editingCredentials"
          class="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
          type="button"
          @click="startEdit"
        >
          修改
        </button>
      </div>

      <!-- 已配置（只读展示） -->
      <div v-if="credentials?.hasApiKey && !editingCredentials" class="space-y-1 text-xs text-gray-600">
        <div>Provider：<span class="text-gray-800">{{ credentials.provider ?? "openai" }}</span></div>
        <div>Base URL：<span class="font-mono text-gray-800">{{ credentials.apiBaseUrl }}</span></div>
        <div>Model：<span class="font-mono text-gray-800">{{ credentials.model || "（未设置）" }}</span></div>
        <div>API Key：<span class="font-mono text-gray-800">{{ credentials.accountLabel || "***" }}</span></div>
        <div v-if="credentials.savedAt" class="text-gray-400">
          保存于 {{ new Date(credentials.savedAt).toLocaleString() }}
        </div>
        <button
          class="mt-2 text-xs text-red-500 hover:text-red-700 cursor-pointer"
          type="button"
          @click="emit('remove-credentials')"
        >
          清除凭据
        </button>
      </div>

      <!-- 编辑/新增表单 -->
      <div v-else class="space-y-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">Provider</label>
          <select
            v-model="formProvider"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            :disabled="loadingPresets"
            @change="onProviderChange"
          >
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">API Base URL</label>
          <input
            v-model="formBaseUrl"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            placeholder="https://..."
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Model</label>
          <input
            v-model="formModel"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            placeholder="模型 ID"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">API Key</label>
          <input
            v-model="formApiKey"
            type="password"
            autocomplete="off"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            placeholder="sk-..."
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
            type="button"
            :disabled="savingCredentials || !formApiKey.trim() || !formBaseUrl.trim()"
            @click="submit"
          >
            {{ savingCredentials ? "保存中…" : "保存" }}
          </button>
          <button
            v-if="credentials?.hasApiKey"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
            type="button"
            @click="cancelEdit"
          >
            取消
          </button>
        </div>
        <p v-if="credError" class="text-xs text-red-600">{{ credError }}</p>
      </div>
    </div>

    <!-- ④ 日志查看（仅在线 + 已配对） -->
    <div v-if="companionOnline && companionPaired" class="rounded-lg border border-gray-200 p-4 space-y-3">
      <h4 class="text-sm font-medium text-gray-700">日志</h4>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="logDate"
          type="date"
          class="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-gray-500"
        />
        <select
          v-model="logLines"
          class="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-gray-500"
        >
          <option :value="50">最近 50 行</option>
          <option :value="100">最近 100 行</option>
          <option :value="200">最近 200 行</option>
        </select>
        <button
          class="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer"
          type="button"
          :disabled="logsLoading"
          @click="refreshLogs"
        >
          {{ logsLoading ? "加载中…" : "刷新" }}
        </button>
      </div>

      <p v-if="logsError" class="text-xs text-red-600">{{ logsError }}</p>

      <pre
        v-if="logs && logs.lines.length"
        class="max-h-72 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100 font-mono whitespace-pre-wrap break-all"
      >{{ logs.lines.join("\n") }}</pre>
      <p v-else-if="logs && !logs.lines.length" class="text-xs text-gray-400">暂无日志。</p>
      <p v-else class="text-xs text-gray-400">点击"刷新"加载日志。</p>
    </div>
  </section>
</template>
