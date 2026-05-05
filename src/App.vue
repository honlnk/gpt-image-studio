<script setup lang="ts">
import { computed, ref } from "vue";
import ChatWorkspace from "./components/studio/ChatWorkspace.vue";
import ConversationSidebar from "./components/studio/ConversationSidebar.vue";
import ImageLibrary from "./components/studio/ImageLibrary.vue";
import ImagePreviewModal from "./components/studio/ImagePreviewModal.vue";
import SettingsModal from "./components/studio/SettingsModal.vue";
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
      :attached-image-ids="studio.activeAttachments.value.map((image) => image.id)"
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
      @close="studio.closeSettings"
      @delete-conversations="studio.deleteConversations"
      @delete-images="studio.deleteImages"
      @export-backup="studio.exportBackup"
      @import-backup="studio.importBackup"
      @preview-image="previewImageId = $event"
    />

    <ImagePreviewModal
      :image="previewImage"
      @close="previewImageId = ''"
    />

    <div
      v-if="studio.notice.value"
      class="fixed bottom-4 right-4 z-[70] max-w-sm rounded-lg border bg-white px-4 py-3 text-sm shadow-xl"
      :class="
        studio.notice.value.type === 'error'
          ? 'border-red-200 text-red-700'
          : 'border-gray-200 text-gray-800'
      "
      role="status"
    >
      <div class="flex items-start gap-3">
        <div
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="
            studio.notice.value.type === 'error'
              ? 'bg-red-100 text-red-600'
              : 'bg-gray-900 text-white'
          "
          aria-hidden="true"
        >
          <svg
            v-if="studio.notice.value.type === 'error'"
            class="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
              clip-rule="evenodd"
            />
          </svg>
          <svg
            v-else
            class="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42 0L3.29 9.224a1 1 0 1 1 1.42-1.408l4.04 4.074 6.54-6.594a1 1 0 0 1 1.414-.006z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
        <p class="min-w-0 flex-1 leading-relaxed">
          {{ studio.notice.value.message }}
        </p>
        <button
          class="cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="关闭提示"
          type="button"
          @click="studio.dismissNotice"
        >
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
            />
          </svg>
        </button>
      </div>
    </div>
  </main>
</template>
