<script setup lang="ts">
import { ref, watch } from "vue";
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
import AboutPanel from "../settings/AboutPanel.vue";
import AnalyticsPanel from "../settings/AnalyticsPanel.vue";
import ApiSettingsPanel from "../settings/ApiSettingsPanel.vue";
import BackupPanel from "../settings/BackupPanel.vue";
import BatchOperationsPanel from "../settings/BatchOperationsPanel.vue";
import FavoritePromptsPanel from "../settings/FavoritePromptsPanel.vue";
import GeneralSettingsPanel from "../settings/GeneralSettingsPanel.vue";
import PromptGuardSettingsPanel from "../settings/PromptGuardSettingsPanel.vue";
import PromptModeSettingsPanel from "../settings/PromptModeSettingsPanel.vue";
import ConfirmInputModal from "../ui/ConfirmInputModal.vue";

type SettingsTab =
  | "general"
  | "api"
  | "promptMode"
  | "favoritePrompts"
  | "prompt"
  | "backup"
  | "batch"
  | "analytics"
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
}>();

const activeTab = ref<SettingsTab>("general");
const pendingBackupFile = ref<File | null>(null);
const isRestoreConfirmOpen = ref(false);

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "通用" },
  { key: "api", label: "接口" },
  { key: "promptMode", label: "提示词模式" },
  { key: "favoritePrompts", label: "常用提示词" },
  { key: "prompt", label: "提示词保护" },
  { key: "backup", label: "数据备份" },
  { key: "batch", label: "批量操作" },
  { key: "analytics", label: "行为日志" },
  { key: "about", label: "关于" },
];

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    if (props.initialTab) {
      activeTab.value = props.initialTab;
    }
  },
);

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
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <section
        aria-labelledby="settingsTitle"
        aria-modal="true"
        class="flex h-[min(88vh,44rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
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
              @update:auto-retry-on-network-error="emit('update:autoRetryOnNetworkError', $event)"
            />

            <ApiSettingsPanel
              v-else-if="activeTab === 'api'"
              :connection-mode="connectionMode"
              :api-base-url="apiBaseUrl"
              :api-base-url-mode="apiBaseUrlMode"
              :api-mode="apiMode"
              :api-key="apiKey"
              :model="model"
              :stream-images="streamImages"
              :stream-partial-images="streamPartialImages"
              @update:connection-mode="emit('update:connectionMode', $event)"
              @update:api-base-url="emit('update:apiBaseUrl', $event)"
              @update:api-base-url-mode="emit('update:apiBaseUrlMode', $event)"
              @update:api-mode="emit('update:apiMode', $event)"
              @update:api-key="emit('update:apiKey', $event)"
              @update:model="emit('update:model', $event)"
              @update:stream-images="emit('update:streamImages', $event)"
              @update:stream-partial-images="emit('update:streamPartialImages', $event)"
            />

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
      </section>
    </div>
  </Teleport>

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
