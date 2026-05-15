<script setup lang="ts">
import { ref } from "vue";
import { useComposerStore } from "../../stores/composerStore";
import type { ImageAsset } from "../../types/studio";
import ComposerAttachmentList from "./ComposerAttachmentList.vue";
import ComposerParameterBar from "./ComposerParameterBar.vue";
import PromptInputBox from "./PromptInputBox.vue";

defineProps<{
  activeAttachments: ImageAsset[];
  canSend: boolean;
  isDragActive: boolean;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  closeAllEditors: [];
  importImages: [files: File[]];
  removeAttachment: [id: string];
  submitMessage: [];
  "update:editModeEnabled": [value: boolean];
}>();

const composer = useComposerStore();
const promptInputRef = ref<InstanceType<typeof PromptInputBox> | null>(null);

function focusComposer() {
  promptInputRef.value?.focusComposer();
}

defineExpose({ focusComposer });
</script>

<template>
  <div
    class="border-t border-gray-200 bg-white px-4 py-3"
    @click="emit('closeAllEditors')"
  >
    <form class="mx-auto max-w-3xl" @submit.prevent="emit('submitMessage')">
      <ComposerAttachmentList
        :active-attachments="activeAttachments"
        :active-edit-mask-image-id="composer.activeEditMaskImageId"
        :active-edit-source-image-id="composer.activeEditSourceImageId"
        @remove-attachment="emit('removeAttachment', $event)"
      />

      <PromptInputBox
        ref="promptInputRef"
        :active-attachment-count="activeAttachments.length"
        :can-send="canSend"
        :composer-text="composer.composerText"
        :is-drag-active="isDragActive"
        :is-generating="isGenerating"
        @import-images="emit('importImages', $event)"
        @submit-message="emit('submitMessage')"
        @update:composer-text="composer.composerText = $event"
      >
        <div class="relative min-w-0 flex-1" @click.stop>
          <ComposerParameterBar
            @update:edit-mode-enabled="emit('update:editModeEnabled', $event)"
          />
        </div>
      </PromptInputBox>
    </form>
  </div>
</template>
