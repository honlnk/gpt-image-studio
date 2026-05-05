<script setup lang="ts">
import { computed, ref } from "vue";
import ChatWorkspace from "./components/studio/ChatWorkspace.vue";
import ConversationSidebar from "./components/studio/ConversationSidebar.vue";
import ImageLibrary from "./components/studio/ImageLibrary.vue";
import ImagePreviewModal from "./components/studio/ImagePreviewModal.vue";
import SettingsModal from "./components/studio/SettingsModal.vue";
import ConfirmDialog from "./components/ui/ConfirmDialog.vue";
import NoticeToast from "./components/ui/NoticeToast.vue";
import { useStudioState } from "./composables/useStudioState";

const studio = useStudioState();
const previewImageId = ref("");
const isConversationSidebarOpen = ref(false);
const settingsInitialTab = ref<"api" | "backup" | "batch">("api");
const settingsInitialBatchPanel = ref<"images" | "conversations">("images");
const previewImage = computed(() => studio.imageById(previewImageId.value));

function openBatchImageOperations() {
  settingsInitialTab.value = "batch";
  settingsInitialBatchPanel.value = "images";
  studio.openSettings();
}

function openSettingsDefault() {
  settingsInitialTab.value = "api";
  settingsInitialBatchPanel.value = "images";
  studio.openSettings();
}
</script>

<template>
  <main class="flex h-screen bg-white text-gray-900 antialiased">
    <ConversationSidebar
      v-model:is-open="isConversationSidebarOpen"
      :active-conversation-id="studio.activeConversationId.value"
      :conversations="studio.conversations.value"
      @create-conversation="studio.createConversation"
      @delete-conversation="studio.deleteConversation"
      @open-settings="openSettingsDefault"
      @select-conversation="studio.selectConversation"
    />

    <ChatWorkspace
      v-model:background="studio.background.value"
      v-model:composer-text="studio.composerText.value"
      v-model:image-height="studio.imageHeight.value"
      v-model:image-width="studio.imageWidth.value"
      v-model:is-library-open="studio.isLibraryOpen.value"
      v-model:output-format="studio.outputFormat.value"
      v-model:quality="studio.quality.value"
      :active-attachments="studio.activeAttachments.value"
      :active-conversation="studio.activeConversation.value"
      :active-editor="studio.activeEditor.value"
      :active-messages="studio.activeMessages.value"
      :active-size-preset="studio.activeSizePreset.value"
      :background-label="studio.backgroundLabel.value"
      :background-options="studio.backgroundOptions"
      :can-send="studio.canSend.value"
      :custom-size-error="studio.customSizeError.value"
      :format-label="studio.formatLabel.value"
      :format-options="studio.formatOptions"
      :image-by-id="studio.imageById"
      :is-editor-expanded="studio.isEditorExpanded.value"
      :is-generating="studio.isGenerating.value"
      :model="studio.model.value"
      :quality-label="studio.qualityLabel.value"
      :quality-options="studio.qualityOptions"
      :size-label="studio.sizeLabel.value"
      :size-presets="studio.sizePresets"
      @apply-size-preset="studio.applySizePreset"
      @attach-image="studio.attachImage"
      @close-all-editors="studio.closeAllEditors"
      @import-images="studio.importImages"
      @open-conversations="isConversationSidebarOpen = true"
      @open-settings="openSettingsDefault"
      @preview-image="previewImageId = $event"
      @remove-attachment="studio.removeAttachment"
      @retry-message="studio.retryMessage"
      @submit-message="studio.submitMessage"
      @toggle-editor="studio.toggleEditor"
    />

    <ImageLibrary
      v-model:is-open="studio.isLibraryOpen.value"
      :active-conversation-id="studio.activeConversationId.value"
      :attached-image-ids="
        studio.activeAttachments.value.map((image) => image.id)
      "
      :images="studio.imageAssets.value"
      @attach-image="studio.attachImage"
      @delete-image="studio.deleteImage"
      @open-batch-operations="openBatchImageOperations"
      @preview-image="previewImageId = $event"
      :storage-usage="studio.storageUsage.value"
    />

    <SettingsModal
      v-model:api-base-url="studio.apiBaseUrl.value"
      v-model:api-key="studio.apiKey.value"
      :conversations="studio.conversations.value"
      :images="studio.imageAssets.value"
      :initial-batch-panel="settingsInitialBatchPanel"
      :initial-tab="settingsInitialTab"
      :is-open="studio.isSettingsOpen.value"
      :messages="studio.messages.value"
      @close="studio.closeSettings"
      @delete-conversations="studio.deleteConversations"
      @delete-images="studio.deleteImages"
      @export-backup="studio.exportBackup"
      @import-backup="studio.importBackup"
      @preview-image="previewImageId = $event"
    />

    <ImagePreviewModal :image="previewImage" @close="previewImageId = ''" />

    <NoticeToast
      :notice="studio.notice.value"
      @close="studio.dismissNotice"
    />

    <ConfirmDialog
      :dialog="studio.confirmDialog.value"
      @cancel="studio.cancelConfirmDialog"
      @confirm="studio.acceptConfirmDialog"
    />
  </main>
</template>
