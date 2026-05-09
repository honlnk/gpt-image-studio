<script setup lang="ts">
import ChatWorkspace from "./components/studio/ChatWorkspace.vue";
import ConversationSidebar from "./components/studio/ConversationSidebar.vue";
import ImageLibrary from "./components/studio/ImageLibrary.vue";
import ImagePreviewModal from "./components/studio/ImagePreviewModal.vue";
import SettingsModal from "./components/studio/SettingsModal.vue";
import ConfirmDialog from "./components/ui/ConfirmDialog.vue";
import NoticeToast from "./components/ui/NoticeToast.vue";
import { useStudioViewModel } from "./app/studio";

const studio = useStudioViewModel();
</script>

<template>
  <main class="flex h-screen bg-white text-gray-900 antialiased">
    <ConversationSidebar
      v-model:is-open="studio.sidebar.isOpen"
      :active-conversation-id="studio.sidebar.activeConversationId"
      :conversations="studio.sidebar.conversations"
      @create-conversation="studio.sidebar.createConversation"
      @delete-conversation="studio.sidebar.deleteConversation"
      @open-settings="studio.sidebar.openSettings"
      @select-conversation="studio.sidebar.selectConversation"
    />

    <ChatWorkspace
      v-model:background="studio.chat.background"
      v-model:composer-text="studio.chat.composerText"
      v-model:image-height="studio.chat.imageHeight"
      v-model:image-width="studio.chat.imageWidth"
      v-model:is-library-open="studio.chat.isLibraryOpen"
      v-model:output-format="studio.chat.outputFormat"
      v-model:quality="studio.chat.quality"
      :active-attachments="studio.chat.activeAttachments"
      :active-conversation="studio.chat.activeConversation"
      :active-editor="studio.chat.activeEditor"
      :active-messages="studio.chat.activeMessages"
      :active-size-preset="studio.chat.activeSizePreset"
      :background-label="studio.chat.backgroundLabel"
      :background-options="studio.chat.backgroundOptions"
      :can-send="studio.chat.canSend"
      :custom-size-error="studio.chat.customSizeError"
      :format-label="studio.chat.formatLabel"
      :format-options="studio.chat.formatOptions"
      :image-by-id="studio.chat.imageById"
      :is-editor-expanded="studio.chat.isEditorExpanded"
      :is-generating="studio.chat.isGenerating"
      :model="studio.chat.model"
      :quality-label="studio.chat.qualityLabel"
      :quality-options="studio.chat.qualityOptions"
      :size-label="studio.chat.sizeLabel"
      :size-presets="studio.chat.sizePresets"
      @apply-size-preset="studio.chat.applySizePreset"
      @attach-image="studio.chat.attachImage"
      @close-all-editors="studio.chat.closeAllEditors"
      @import-images="studio.chat.importImages"
      @open-conversations="studio.chat.openConversations"
      @open-settings="studio.chat.openSettings"
      @preview-image="studio.chat.previewImage"
      @remove-attachment="studio.chat.removeAttachment"
      @retry-message="studio.chat.retryMessage"
      @submit-message="studio.chat.submitMessage"
      @toggle-editor="studio.chat.toggleEditor"
    />

    <ImageLibrary
      v-model:is-open="studio.library.isOpen"
      :active-conversation-id="studio.library.activeConversationId"
      :attached-image-ids="studio.library.attachedImageIds"
      :images="studio.library.images"
      @attach-image="studio.library.attachImage"
      @delete-image="studio.library.deleteImage"
      @open-batch-operations="studio.library.openBatchOperations"
      @preview-image="studio.library.previewImage"
      :storage-usage="studio.library.storageUsage"
    />

    <SettingsModal
      v-model:api-base-url="studio.settingsModal.apiBaseUrl"
      v-model:api-key="studio.settingsModal.apiKey"
      v-model:connection-mode="studio.settingsModal.connectionMode"
      :conversations="studio.settingsModal.conversations"
      :images="studio.settingsModal.images"
      :initial-batch-panel="studio.settingsModal.initialBatchPanel"
      :initial-tab="studio.settingsModal.initialTab"
      :is-open="studio.settingsModal.isOpen"
      :messages="studio.settingsModal.messages"
      @close="studio.settingsModal.close"
      @delete-conversations="studio.settingsModal.deleteConversations"
      @delete-images="studio.settingsModal.deleteImages"
      @export-backup="studio.settingsModal.exportBackup"
      @import-backup="studio.settingsModal.importBackup"
      @preview-image="studio.settingsModal.previewImage"
    />

    <ImagePreviewModal
      :image="studio.preview.image"
      @close="studio.preview.close"
    />

    <NoticeToast
      :notice="studio.noticeToast.notice"
      @close="studio.noticeToast.close"
    />

    <ConfirmDialog
      :dialog="studio.confirmDialog.dialog"
      @cancel="studio.confirmDialog.cancel"
      @confirm="studio.confirmDialog.confirm"
    />
  </main>
</template>
