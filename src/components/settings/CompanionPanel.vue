<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type {
  CompanionAuthStatus,
  CompanionCorruptionEvent,
  CompanionCredentialEntry,
  CompanionCredentialInput,
  CompanionHealthResponse,
  CompanionLogsTailResponse,
  CompanionProviderPreset,
} from "../../types/companion";
import ConfirmDialog from "../ui/ConfirmDialog.vue";

const props = defineProps<{
  // 连接状态（透传自 useCompanionConnection）。
  companionUrl: string;
  companionAccessKey: string;
  companionConnected: boolean;
  companionOnline: boolean;
  companionHealth: CompanionHealthResponse | null;
  companionAuthStatus: CompanionAuthStatus | null;
  connectError: string;
  connecting: boolean;
  // 凭据列表 + 日志（来自 useCompanionManagement）。
  presets: CompanionProviderPreset[];
  credentialList: CompanionCredentialEntry[];
  activeCredentialId: string | null;
  logs: CompanionLogsTailResponse | null;
  loadingPresets: boolean;
  loadingCredentials: boolean;
  savingCredentials: boolean;
  logsLoading: boolean;
  credError: string;
  logsError: string;
  // 凭据文件损坏事件 + 恢复动作 loading。
  corruptEvent: CompanionCorruptionEvent | null;
  loadingReset: boolean;
  loadingRestore: boolean;
}>();

const emit = defineEmits<{
  "check-status": [];
  "connect-with-key": [key: string];
  "disconnect-companion": [];
  // 凭据列表 CRUD 动作。
  "load-presets": [];
  "load-credentials": [];
  "add-credential": [form: CompanionCredentialInput];
  "update-credential": [id: string, form: CompanionCredentialInput];
  "remove-credential": [id: string];
  "activate-credential": [id: string];
  "load-logs": [params: { lines?: number; date?: string }];
  // 凭据损坏恢复动作。
  "reset-credential-store": [];
  "restore-credential-backup": [];
}>();

// ---- 凭据表单本地态 ----
// editingId：null = 新增模式；有值 = 编辑该 id；"" = 表单关闭。
const editingId = ref<string | null | "">("");
const formLabel = ref("");
const formProvider = ref("");
const formBaseUrl = ref("");
const formModel = ref("");
const formApiKey = ref("");
// apiKey 明文显隐切换（列表展示和编辑表单均可切换）。
const showApiKey = ref<Record<string, boolean>>({});

// ---- 删除确认对话框 ----
const deleteDialog = ref<{
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger";
} | null>(null);
const pendingDeleteId = ref<string | null>(null);

// ---- 重置成空配置的二次确认 ----
// 破坏性操作（丢弃损坏历史，无法找回已写入的新状态），需要二次确认；
// 从备份恢复是非破坏的补救动作，不需要确认。
const resetDialog = ref<{
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger";
} | null>(null);

function askResetEmpty() {
  resetDialog.value = {
    title: "重置成空配置",
    description:
      "将丢弃当前损坏的凭据文件，写入一份干净的空配置。之前备份的 .corrupt-*.json 文件会保留在配置目录中，可手动找回。确定继续吗？",
    confirmLabel: "重置成空配置",
    tone: "danger",
  };
}

function onResetDialogConfirm() {
  resetDialog.value = null;
  emit("reset-credential-store");
}

function onResetDialogCancel() {
  resetDialog.value = null;
}

// ---- 连接密钥输入本地态 ----
const accessKeyInput = ref("");

function connect() {
  emit("connect-with-key", accessKeyInput.value);
  accessKeyInput.value = "";
}

// ---- 凭据表单操作 ----

function startAdd() {
  editingId.value = null;
  formLabel.value = "";
  formProvider.value = props.presets[0]?.id ?? "";
  formBaseUrl.value = props.presets[0]?.defaultBaseUrl ?? "";
  formModel.value = props.presets[0]?.defaultModel ?? "";
  formApiKey.value = "";
}

function startEdit(entry: CompanionCredentialEntry) {
  editingId.value = entry.id;
  formLabel.value = entry.label;
  formProvider.value = entry.provider;
  formBaseUrl.value = entry.apiBaseUrl;
  formModel.value = entry.model;
  formApiKey.value = entry.apiKey;
}

function cancelForm() {
  editingId.value = "";
  formApiKey.value = "";
}

function onProviderChange() {
  // 切 provider 时强制刷新默认值（用户体验：选了 provider 就用它的默认）。
  const preset = props.presets.find((p) => p.id === formProvider.value);
  if (preset) {
    formBaseUrl.value = preset.defaultBaseUrl;
    formModel.value = preset.defaultModel;
  }
}

function submit() {
  const form: CompanionCredentialInput = {
    label: formLabel.value.trim() || undefined,
    provider: formProvider.value || undefined,
    apiBaseUrl: formBaseUrl.value.trim(),
    apiKey: formApiKey.value.trim(),
    model: formModel.value.trim() || undefined,
  };
  if (editingId.value === null) {
    emit("add-credential", form);
  } else if (editingId.value) {
    emit("update-credential", editingId.value, form);
  }
  // 保存后关闭表单，清空内存里的 key 输入。
  editingId.value = "";
  formApiKey.value = "";
}

function confirmDelete(entry: CompanionCredentialEntry) {
  pendingDeleteId.value = entry.id;
  deleteDialog.value = {
    title: `删除「${entry.label}」`,
    description: "确定删除这条 provider 配置吗？此操作不可撤销。",
    confirmLabel: "删除",
    tone: "danger",
  };
}

function onDialogConfirm() {
  if (pendingDeleteId.value) {
    emit("remove-credential", pendingDeleteId.value);
  }
  deleteDialog.value = null;
  pendingDeleteId.value = null;
}

function onDialogCancel() {
  deleteDialog.value = null;
  pendingDeleteId.value = null;
}

function toggleApiKeyVisibility(id: string) {
  showApiKey.value = { ...showApiKey.value, [id]: !showApiKey.value[id] };
}

/** 列表展示用的 key 掩码（编辑表单里用明文）。 */
function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 8) + "***";
}

function providerLabel(id: string): string {
  return props.presets.find((p) => p.id === id)?.label ?? id;
}

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
    <ConfirmDialog :dialog="deleteDialog" @cancel="onDialogCancel" @confirm="onDialogConfirm" />
    <ConfirmDialog
      :dialog="resetDialog"
      @cancel="onResetDialogCancel"
      @confirm="onResetDialogConfirm"
    />

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

      <template v-if="!companionOnline">
        <p class="text-xs text-gray-500">
          请先在终端启动 Companion 服务，然后点击"刷新"：
        </p>
        <div class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
          <div class="font-mono text-gray-800">npm install -g @honlnk/image-studio-companion</div>
          <div class="font-mono text-gray-800">gpt-image-studio provider add</div>
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
            <span class="text-gray-500"> · {{ companionAuthStatus.accountLabel }}</span>
            <span class="text-gray-500"> · {{ companionAuthStatus.provider }}</span>
            <span v-if="companionAuthStatus.model" class="text-gray-500"> · {{ companionAuthStatus.model }}</span>
          </template>
        </div>
      </template>
    </div>

    <!-- ② 连接管理（仅在线） -->
    <div v-if="companionOnline" class="rounded-lg border border-gray-200 p-4 space-y-3">
      <h4 class="text-sm font-medium text-gray-700">连接</h4>

      <template v-if="companionConnected">
        <div class="flex items-center justify-between">
          <span class="text-sm text-green-700">已连接</span>
          <button
            class="text-xs text-red-500 hover:text-red-700 cursor-pointer"
            type="button"
            @click="emit('disconnect-companion')"
          >
            断开连接
          </button>
        </div>
      </template>

      <template v-else>
        <p class="text-sm text-gray-500">
          请将 Companion 终端打印的连接密钥粘贴到下方完成连接。
          密钥可在终端用 <span class="font-mono text-gray-700">gpt-image-studio status</span> 查看。
        </p>
        <div class="flex gap-2">
          <input
            v-model="accessKeyInput"
            class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            placeholder="粘贴连接密钥"
            @keydown.enter="connect"
          />
          <button
            class="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
            type="button"
            :disabled="connecting || !accessKeyInput.trim()"
            @click="connect"
          >
            {{ connecting ? "连接中…" : "连接" }}
          </button>
        </div>
      </template>

      <p v-if="connectError" class="text-xs text-red-600">{{ connectError }}</p>
    </div>

    <!-- ②.5 凭据异常（仅损坏时） -->
    <div
      v-if="companionOnline && corruptEvent"
      class="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-red-800">⚠️ 凭据文件异常</span>
      </div>
      <p class="text-xs leading-relaxed text-red-700">
        {{ corruptEvent.message }}
      </p>
      <p class="text-xs text-red-600">
        可以尝试从备份恢复；若备份也坏了，或不需要历史配置，可重置成空配置后重新添加。
      </p>
      <div class="flex flex-wrap gap-2 pt-1">
        <button
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
          type="button"
          :disabled="loadingRestore || loadingReset"
          @click="emit('restore-credential-backup')"
        >
          {{ loadingRestore ? "恢复中…" : "从备份恢复" }}
        </button>
        <button
          class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50 cursor-pointer"
          type="button"
          :disabled="loadingRestore || loadingReset"
          @click="askResetEmpty"
        >
          {{ loadingReset ? "重置中…" : "重置成空配置" }}
        </button>
      </div>
    </div>

    <!-- ③ 凭据列表（仅在线 + 未损坏） -->
    <div
      v-if="companionOnline && !corruptEvent"
      class="rounded-lg border border-gray-200 p-4 space-y-3"
    >
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium text-gray-700">API 凭据</h4>
        <button
          v-if="editingId === ''"
          class="text-xs text-gray-600 hover:text-gray-900 cursor-pointer rounded-md border border-gray-300 px-2 py-1 hover:bg-gray-50"
          type="button"
          @click="startAdd"
        >
          + 新增
        </button>
      </div>

      <p v-if="loadingCredentials" class="text-xs text-gray-400">加载中…</p>

      <!-- 空列表提示 -->
      <p v-else-if="credentialList.length === 0 && editingId === ''" class="text-xs text-gray-400">
        暂无 provider 配置，点击「新增」添加。
      </p>

      <!-- 新增/编辑表单 -->
      <div v-if="editingId !== ''" class="space-y-3 rounded-lg bg-gray-50 p-4">
        <div class="text-xs font-medium text-gray-600">
          {{ editingId === null ? "新增配置" : "编辑配置" }}
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">名称</label>
          <input
            v-model="formLabel"
            class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
            placeholder="如：豆包测试号"
          />
        </div>
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
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
            type="button"
            @click="cancelForm"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 凭据列表 -->
      <div v-if="editingId === ''" class="space-y-2">
        <div
          v-for="entry in credentialList"
          :key="entry.id"
          class="rounded-lg border border-gray-200 p-3 space-y-2"
          :class="entry.id === activeCredentialId ? 'ring-1 ring-green-400 bg-green-50/30' : ''"
        >
          <!-- 头部：名称 + 激活标记 + 操作 -->
          <div class="flex items-center gap-2">
            <span
              class="inline-block h-2 w-2 rounded-full"
              :class="entry.id === activeCredentialId ? 'bg-green-500' : 'bg-gray-300'"
            />
            <span class="text-sm font-medium text-gray-900">{{ entry.label }}</span>
            <span
              v-if="entry.id === activeCredentialId"
              class="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
            >
              激活中
            </span>
            <div class="ml-auto flex items-center gap-2">
              <button
                v-if="entry.id !== activeCredentialId"
                class="text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
                type="button"
                @click="emit('activate-credential', entry.id)"
              >
                激活
              </button>
              <button
                class="text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
                type="button"
                @click="startEdit(entry)"
              >
                编辑
              </button>
              <button
                class="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                type="button"
                @click="confirmDelete(entry)"
              >
                删除
              </button>
            </div>
          </div>

          <!-- 详情 -->
          <div class="space-y-0.5 text-xs text-gray-500">
            <div>
              <span class="text-gray-400">Provider：</span>
              <span class="text-gray-700">{{ providerLabel(entry.provider) }}</span>
            </div>
            <div>
              <span class="text-gray-400">Base URL：</span>
              <span class="font-mono text-gray-700">{{ entry.apiBaseUrl }}</span>
            </div>
            <div>
              <span class="text-gray-400">Model：</span>
              <span class="font-mono text-gray-700">{{ entry.model || "（未设置）" }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-gray-400">API Key：</span>
              <span class="font-mono text-gray-700">
                {{ showApiKey[entry.id] ? entry.apiKey : maskKey(entry.apiKey) }}
              </span>
              <button
                class="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                type="button"
                @click="toggleApiKeyVisibility(entry.id)"
              >
                {{ showApiKey[entry.id] ? "隐藏" : "显示" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p v-if="credError" class="text-xs text-red-600">{{ credError }}</p>
    </div>

    <!-- ④ 日志查看（仅在线 + 已配对 + 未损坏） -->
    <div
      v-if="companionOnline && companionConnected && !corruptEvent"
      class="rounded-lg border border-gray-200 p-4 space-y-3"
    >
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
