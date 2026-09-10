<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSettingsStore } from "../../stores/settingsStore";
import type {
  AnalyticsPromptCapture,
  ApiMode,
  ConnectionMode,
  Conversation,
  FavoritePrompt,
  ImageAsset,
  Message,
  PromptMode,
  PromptWordbankSectionKey,
  PromptWordbanks,
  PromptRewriteGuardHistoryItem,
} from "../../types/studio";
import { readStorage, writeStorage } from "../../shared/localStorage";
import type { AnalyticsInsights } from "../../services/analyticsAnalysis";
import AboutPanel from "../settings/AboutPanel.vue";
import AnalyticsPanel from "../settings/AnalyticsPanel.vue";
import AnalyticsDashboard from "../settings/AnalyticsDashboard.vue";
import ApiSettingsPanel from "../settings/ApiSettingsPanel.vue";
import CompanionInfoPanel from "../settings/CompanionInfoPanel.vue";
import BackupPanel from "../settings/BackupPanel.vue";
import BatchOperationsPanel from "../settings/BatchOperationsPanel.vue";
import FavoritePromptsPanel from "../settings/FavoritePromptsPanel.vue";
import GeneralSettingsPanel from "../settings/GeneralSettingsPanel.vue";
import PromptGuardSettingsPanel from "../settings/PromptGuardSettingsPanel.vue";
import PromptModeSettingsPanel from "../settings/PromptModeSettingsPanel.vue";
import ConfirmInputModal from "../ui/ConfirmInputModal.vue";
import BaseModal from "../ui/BaseModal.vue";

type SettingsTab =
  | "general"
  | "api"
  | "companion"
  | "promptMode"
  | "favoritePrompts"
  | "prompt"
  | "backup"
  | "batch"
  | "analytics"
  | "dashboard"
  | "about";
type BatchPanel = "images" | "conversations";

const props = defineProps<{
  isOpen: boolean;
  initialBatchPanel?: BatchPanel;
  initialTab?: SettingsTab;
  autoRetryOnNetworkError: boolean;
  connectionMode: ConnectionMode;
  apiKey: string;
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiMode: ApiMode;
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
  model: string;
  modelOptions: ReadonlyArray<{ value: string; label: string }>;
  modelsProbe: {
    status: "idle" | "loading" | "ok" | "error";
    modelIds: string[];
    message: string;
  };
  promptMode: PromptMode;
  promptWordbanks: PromptWordbanks;
  favoritePrompts: FavoritePrompt[];
  promptRewriteGuardEnabled: boolean;
  promptRewriteGuardText: string;
  promptRewriteGuardHistory: PromptRewriteGuardHistoryItem[];
  conversations: Conversation[];
  images: ImageAsset[];
  messages: Message[];
  analyticsEnabled: boolean;
  analyticsPromptCapture: AnalyticsPromptCapture;
  analyticsEventCount: number;
  analyticsInsights: AnalyticsInsights | null;
}>();

const emit = defineEmits<{
  close: [];
  deleteConversations: [ids: string[]];
  deleteImages: [ids: string[]];
  exportBackup: [];
  importBackup: [file: File];
  previewImage: [id: string];
  "update:autoRetryOnNetworkError": [value: boolean];
  "update:connectionMode": [value: ConnectionMode];
  "update:apiKey": [value: string];
  "update:apiBaseUrl": [value: string];
  "update:apiBaseUrlMode": [value: "origin" | "full"];
  "update:apiMode": [value: ApiMode];
  "update:streamImages": [value: boolean];
  "update:streamPartialImages": [value: 0 | 1 | 2 | 3];
  "update:model": [value: string];
  probeModels: [];
  "update:promptMode": [value: PromptMode];
  savePromptWordbank: [section: PromptWordbankSectionKey, terms: string[]];
  restoreDefaultPromptWordbank: [section: PromptWordbankSectionKey];
  addFavoritePrompt: [value: { title: string; text: string }];
  updateFavoritePrompt: [id: string, value: { title: string; text: string }];
  deleteFavoritePrompt: [id: string];
  "update:promptRewriteGuardEnabled": [value: boolean];
  savePromptRewriteGuardText: [value: string];
  restoreDefaultPromptRewriteGuardText: [];
  restorePromptRewriteGuardHistoryItem: [id: string];
  deletePromptRewriteGuardHistoryItem: [id: string];
  setPromptRewriteGuardEnabled: [value: boolean];
  "update:analyticsEnabled": [value: boolean];
  "update:analyticsPromptCapture": [value: AnalyticsPromptCapture];
  exportAnalyticsEvents: [];
  clearAnalyticsEvents: [];
  refreshAnalyticsInsights: [];
}>();

const activeTab = ref<SettingsTab>("general");
const pendingBackupFile = ref<File | null>(null);
const isRestoreConfirmOpen = ref(false);

// 嵌入态下设置弹窗撑满整个宿主页面（不再被子应用容器/宿主 header/tabbar 遮挡），
// z-index 高于宿主 header（Vben 默认 zIndex=200，offset 后 201）。
const settings = useSettingsStore();
const isEmbedded = computed(() => settings.isEmbedded);

// 接口 tab 仅 direct 模式显示（纯直连配置）；Companion tab 仅 Companion 模式显示。
// Companion 的 provider 凭据/存储位置等配置都在 Companion 自带管理页维护。
const tabs = computed<{ key: SettingsTab; label: string }[]>(() => {
  const base: { key: SettingsTab; label: string }[] = [{ key: "general", label: "通用" }];
  if (props.connectionMode === "localCompanion") {
    base.push({ key: "companion", label: "Companion" });
  } else {
    base.push({ key: "api", label: "接口" });
  }
  base.push(
    { key: "promptMode", label: "提示词模式" },
    { key: "favoritePrompts", label: "常用提示词" },
    { key: "prompt", label: "提示词保护" },
    { key: "backup", label: "数据备份" },
    { key: "batch", label: "批量操作" },
    { key: "analytics", label: "行为日志" },
    { key: "dashboard", label: "数据分析" },
    { key: "about", label: "关于" },
  );
  return base;
});

// 记住上次浏览的 tab：打开时恢复（initialTab 外部指定优先），切换时写回。
// 纯 UI 偏好、与数据后端无关，存 localStorage（与连接配置镜像同一存储）。
const SETTINGS_TAB_STORAGE_KEY = "gpt-image-studio:settings-tab";

function isVisibleTab(tab: string): tab is SettingsTab {
  return tabs.value.some((t) => t.key === tab);
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    // 优先级：initialTab（如「批量操作」跳转）> 记忆值 > general。
    // 记忆值当前不可见时回退 general（如 Companion 模式下记忆的 "api"）。
    const remembered = readStorage(SETTINGS_TAB_STORAGE_KEY, "");
    const candidate = props.initialTab ?? (isVisibleTab(remembered) ? remembered : "general");
    activeTab.value = isVisibleTab(candidate) ? candidate : "general";
  },
);

watch(activeTab, (tab) => {
  if (!props.isOpen) return;
  writeStorage(SETTINGS_TAB_STORAGE_KEY, tab);
});

function requestBackupImport(file: File) {
  pendingBackupFile.value = file;
  isRestoreConfirmOpen.value = true;
}

function cancelConfirm() {
  isRestoreConfirmOpen.value = false;
  pendingBackupFile.value = null;
}

function confirmPendingAction() {
  if (pendingBackupFile.value) {
    emit("importBackup", pendingBackupFile.value);
  }

  isRestoreConfirmOpen.value = false;
  pendingBackupFile.value = null;
}

function forwardSavePromptWordbank(
  section: PromptWordbankSectionKey,
  terms: string[],
) {
  emit("savePromptWordbank", section, terms);
}
</script>

<template>
  <BaseModal
    :is-open="isOpen"
    :z-class="isEmbedded ? 'z-[300]' : 'z-50'"
    backdrop-class="bg-black/50 px-3"
    content-class="flex h-[min(88vh,44rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
    aria-labelledby="settingsTitle"
    @close="emit('close')"
  >
        <div
          class="flex items-start justify-between border-b border-gray-200 px-5 py-4"
        >
          <div>
            <h2 id="settingsTitle" class="text-lg font-semibold text-gray-900">
              设置
            </h2>
          </div>
          <button
            class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭设置"
            type="button"
            @click="emit('close')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            class="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 p-2 md:w-44 md:flex-col md:border-r md:border-b-0"
            aria-label="设置分类"
          >
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="shrink-0 cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
              :class="
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:bg-white hover:text-gray-800'
              "
              type="button"
              v-track="{ name: 'settings.tab_changed', payload: { tab: tab.key } }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>

          <div
            class="flex min-h-0 flex-1 flex-col p-5"
            :class="activeTab === 'favoritePrompts' ? 'overflow-hidden' : 'overflow-y-auto'"
          >
            <GeneralSettingsPanel
              v-if="activeTab === 'general'"
              :auto-retry-on-network-error="autoRetryOnNetworkError"
              :connection-mode="connectionMode"
              @update:auto-retry-on-network-error="emit('update:autoRetryOnNetworkError', $event)"
              @update:connection-mode="emit('update:connectionMode', $event)"
            />

            <ApiSettingsPanel
              v-else-if="activeTab === 'api'"
              :api-base-url="apiBaseUrl"
              :api-base-url-mode="apiBaseUrlMode"
              :api-mode="apiMode"
              :api-key="apiKey"
              :model="model"
              :model-options="modelOptions"
              :models-probe="modelsProbe"
              :stream-images="streamImages"
              :stream-partial-images="streamPartialImages"
              @update:api-base-url="emit('update:apiBaseUrl', $event)"
              @update:api-base-url-mode="emit('update:apiBaseUrlMode', $event)"
              @update:api-mode="emit('update:apiMode', $event)"
              @update:api-key="emit('update:apiKey', $event)"
              @update:model="emit('update:model', $event)"
              @probe-models="emit('probeModels')"
              @update:stream-images="emit('update:streamImages', $event)"
              @update:stream-partial-images="emit('update:streamPartialImages', $event)"
            />

            <CompanionInfoPanel v-else-if="activeTab === 'companion'" />

            <PromptModeSettingsPanel
              v-else-if="activeTab === 'promptMode'"
              :model-value="promptMode"
              :wordbanks="promptWordbanks"
              @restore-default-wordbank="emit('restoreDefaultPromptWordbank', $event)"
              @save-wordbank="forwardSavePromptWordbank"
              @update:model-value="emit('update:promptMode', $event)"
            />

            <FavoritePromptsPanel
              v-else-if="activeTab === 'favoritePrompts'"
              :prompts="favoritePrompts"
              @add-prompt="emit('addFavoritePrompt', $event)"
              @delete-prompt="emit('deleteFavoritePrompt', $event)"
              @update-prompt="(id, value) => emit('updateFavoritePrompt', id, value)"
            />

            <div v-else-if="activeTab === 'prompt'" class="space-y-8">
              <PromptGuardSettingsPanel
                :enabled="promptRewriteGuardEnabled"
                :history="promptRewriteGuardHistory"
                :text="promptRewriteGuardText"
                @delete-history="emit('deletePromptRewriteGuardHistoryItem', $event)"
                @restore-default="emit('restoreDefaultPromptRewriteGuardText')"
                @restore-history="emit('restorePromptRewriteGuardHistoryItem', $event)"
                @save-text="emit('savePromptRewriteGuardText', $event)"
                @update:enabled="emit('setPromptRewriteGuardEnabled', $event)"
              />
            </div>

            <BackupPanel
              v-else-if="activeTab === 'backup'"
              @export-backup="emit('exportBackup')"
              @import-backup-request="requestBackupImport"
            />

            <AnalyticsPanel
              v-else-if="activeTab === 'analytics'"
              :enabled="analyticsEnabled"
              :prompt-capture="analyticsPromptCapture"
              :event-count="analyticsEventCount"
              @update:enabled="emit('update:analyticsEnabled', $event)"
              @update:prompt-capture="emit('update:analyticsPromptCapture', $event)"
              @export-events="emit('exportAnalyticsEvents')"
              @clear-events="emit('clearAnalyticsEvents')"
            />

            <AnalyticsDashboard
              v-else-if="activeTab === 'dashboard'"
              :insights="analyticsInsights"
              @refresh="emit('refreshAnalyticsInsights')"
            />

            <AboutPanel v-else-if="activeTab === 'about'" />

            <BatchOperationsPanel
              v-else
              :conversations="conversations"
              :images="images"
              :initial-batch-panel="initialBatchPanel"
              :is-open="isOpen"
              :messages="messages"
              @delete-conversations="emit('deleteConversations', $event)"
              @delete-images="emit('deleteImages', $event)"
              @preview-image="emit('previewImage', $event)"
            />
          </div>
        </div>

        <div class="flex justify-end border-t border-gray-200 px-5 py-4">
          <button
            class="cursor-pointer rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            type="button"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>
  </BaseModal>

  <ConfirmInputModal
    confirm-label="恢复备份"
    confirm-text="我确认恢复备份并覆盖当前数据"
    description="恢复备份会覆盖当前浏览器里的所有会话、消息和图片。API key 不会从备份中恢复。"
    :is-open="isRestoreConfirmOpen"
    title="恢复备份"
    @cancel="cancelConfirm"
    @confirm="confirmPendingAction"
  />
</template>
