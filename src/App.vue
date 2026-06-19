<script setup lang="ts">
import ChatWorkspace from "./components/studio/ChatWorkspace.vue";
import ConversationSidebar from "./components/studio/ConversationSidebar.vue";
import ImageLibrary from "./components/studio/ImageLibrary.vue";
import ImagePreviewModal from "./components/studio/ImagePreviewModal.vue";
import SettingsModal from "./components/studio/SettingsModal.vue";
import ConfirmDialog from "./components/ui/ConfirmDialog.vue";
import NoticeToast from "./components/ui/NoticeToast.vue";
import RenameDialog from "./components/ui/RenameDialog.vue";
import { useStudioViewModel } from "./app/studio";

const studio = useStudioViewModel();
</script>

<template>
  <main class="flex h-screen bg-white text-gray-900 antialiased">
    <ConversationSidebar
      @create-conversation="studio.sidebar.createConversation"
      @delete-conversation="studio.sidebar.deleteConversation"
      @rename-conversation="studio.sidebar.renameConversation"
      @open-settings="studio.sidebar.openSettings"
      @select-conversation="studio.sidebar.selectConversation"
    />

    <ChatWorkspace
      :actions="studio.chat.actions"
      :header="studio.chat.header"
      :messages="studio.chat.messages"
    />

    <ImageLibrary
      @open-batch-operations="studio.library.openBatchOperations"
      @preview-image="studio.library.previewImage"
      @rename-image="studio.library.renameImage"
    />

    <SettingsModal
      v-model:api-base-url="studio.settingsModal.apiBaseUrl"
      v-model:api-base-url-mode="studio.settingsModal.apiBaseUrlMode"
      v-model:api-mode="studio.settingsModal.apiMode"
      v-model:api-key="studio.settingsModal.apiKey"
      v-model:connection-mode="studio.settingsModal.connectionMode"
      v-model:model="studio.settingsModal.model"
      v-model:stream-images="studio.settingsModal.streamImages"
      v-model:stream-partial-images="studio.settingsModal.streamPartialImages"
      :auto-retry-on-network-error="studio.settingsModal.autoRetryOnNetworkError"
      :companion-paired="studio.settingsModal.companionPaired"
      :companion-session-token="studio.settingsModal.companionSessionToken"
      :companion-url="studio.settingsModal.companionUrl"
      :favorite-prompts="studio.settingsModal.favoritePrompts"
      :prompt-mode="studio.settingsModal.promptMode"
      :prompt-wordbanks="studio.settingsModal.promptWordbanks"
      :prompt-rewrite-guard-enabled="studio.settingsModal.promptRewriteGuardEnabled"
      :prompt-rewrite-guard-history="studio.settingsModal.promptRewriteGuardHistory"
      :prompt-rewrite-guard-text="studio.settingsModal.promptRewriteGuardText"
      :conversations="studio.settingsModal.conversations"
      :images="studio.settingsModal.images"
      :initial-batch-panel="studio.settingsModal.initialBatchPanel"
      :initial-tab="studio.settingsModal.initialTab"
      :is-open="studio.settingsModal.isOpen"
      :messages="studio.settingsModal.messages"
      :analytics-enabled="studio.settingsModal.analyticsEnabled"
      :analytics-prompt-capture="studio.settingsModal.analyticsPromptCapture"
      :analytics-event-count="studio.settingsModal.analyticsEventCount"
      @close="studio.settingsModal.close"
      @delete-conversations="studio.settingsModal.deleteConversations"
      @delete-images="studio.settingsModal.deleteImages"
      @delete-favorite-prompt="studio.settingsModal.deleteFavoritePrompt"
      @delete-prompt-rewrite-guard-history-item="studio.settingsModal.deletePromptRewriteGuardHistoryItem"
      @export-backup="studio.settingsModal.exportBackup"
      @import-backup="studio.settingsModal.importBackup"
      @preview-image="studio.settingsModal.previewImage"
      @restore-default-prompt-rewrite-guard-text="studio.settingsModal.restoreDefaultPromptRewriteGuardText"
      @restore-default-prompt-wordbank="studio.settingsModal.restoreDefaultPromptWordbank"
      @restore-prompt-rewrite-guard-history-item="studio.settingsModal.restorePromptRewriteGuardHistoryItem"
      @save-prompt-rewrite-guard-text="studio.settingsModal.savePromptRewriteGuardText"
      @save-prompt-wordbank="studio.settingsModal.savePromptWordbank"
      @add-favorite-prompt="studio.settingsModal.addFavoritePrompt"
      @set-prompt-rewrite-guard-enabled="studio.settingsModal.setPromptRewriteGuardEnabled"
      @update-favorite-prompt="studio.settingsModal.updateFavoritePrompt"
      @update:companion-session-token="studio.settingsModal.companionSessionToken = $event"
      @update:auto-retry-on-network-error="studio.settingsModal.autoRetryOnNetworkError = $event"
      @update:prompt-mode="studio.settingsModal.setPromptMode"
      @update:analytics-enabled="studio.settingsModal.setAnalyticsEnabled"
      @update:analytics-prompt-capture="studio.settingsModal.setAnalyticsPromptCapture"
      @export-analytics-events="studio.settingsModal.exportAnalyticsEvents"
      @clear-analytics-events="studio.settingsModal.clearAnalyticsEvents"
    />

    <ImagePreviewModal
      :image="studio.preview.image"
      :mask-url="studio.preview.maskUrl"
      @close="studio.preview.close"
      @edit-image="studio.preview.editImage"
    />

    <NoticeToast
      :notice="studio.noticeToast.notice"
      @close="studio.noticeToast.close"
    />

    <RenameDialog
      :confirm-label="studio.renameModal.confirmLabel"
      :description="studio.renameModal.description"
      :initial-value="studio.renameModal.initialValue"
      :is-open="studio.renameModal.isOpen"
      :title="studio.renameModal.title"
      @cancel="studio.renameModal.cancel"
      @confirm="studio.renameModal.confirm"
    />
    <RenameDialog
      :confirm-label="studio.renameImageModal.confirmLabel"
      :description="studio.renameImageModal.description"
      :initial-value="studio.renameImageModal.initialValue"
      :is-open="studio.renameImageModal.isOpen"
      :title="studio.renameImageModal.title"
      @cancel="studio.renameImageModal.cancel"
      @confirm="studio.renameImageModal.confirm"
    />

    <ConfirmDialog
      :dialog="studio.confirmDialog.dialog"
      @cancel="studio.confirmDialog.cancel"
      @confirm="studio.confirmDialog.confirm"
    />
  </main>
</template>
