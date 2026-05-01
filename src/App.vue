<script setup lang="ts">
import ChatWorkspace from "./components/studio/ChatWorkspace.vue";
import ConversationSidebar from "./components/studio/ConversationSidebar.vue";
import ImageLibrary from "./components/studio/ImageLibrary.vue";
import SettingsModal from "./components/studio/SettingsModal.vue";
import { useStudioState } from "./composables/useStudioState";

const studio = useStudioState();
</script>

<template>
  <main class="flex h-screen bg-white text-gray-900 antialiased">
    <ConversationSidebar
      :active-conversation-id="studio.activeConversationId.value"
      :conversations="studio.conversations.value"
      @create-conversation="studio.createConversation"
      @open-settings="studio.openSettings"
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
      :format-label="studio.formatLabel.value"
      :format-options="studio.formatOptions"
      :image-by-id="studio.imageById"
      :is-editor-expanded="studio.isEditorExpanded.value"
      :model="studio.model.value"
      :quality-label="studio.qualityLabel.value"
      :quality-options="studio.qualityOptions"
      :size-label="studio.sizeLabel.value"
      :size-presets="studio.sizePresets"
      @apply-size-preset="studio.applySizePreset"
      @attach-image="studio.attachImage"
      @close-all-editors="studio.closeAllEditors"
      @import-images="studio.importImages"
      @open-settings="studio.openSettings"
      @remove-attachment="studio.removeAttachment"
      @retry-message="studio.retryMessage"
      @submit-message="studio.submitMessage"
      @toggle-editor="studio.toggleEditor"
    />

    <ImageLibrary
      v-model:is-open="studio.isLibraryOpen.value"
      :active-conversation-id="studio.activeConversationId.value"
      :attached-image-ids="studio.activeAttachments.value.map((image) => image.id)"
      :images="studio.imageAssets.value"
      @attach-image="studio.attachImage"
      @delete-image="studio.deleteImage"
    />

    <SettingsModal
      v-model:api-base-url="studio.apiBaseUrl.value"
      v-model:api-key="studio.apiKey.value"
      :is-open="studio.isSettingsOpen.value"
      @close="studio.closeSettings"
    />
  </main>
</template>
