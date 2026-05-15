<script setup lang="ts">
import { ref } from "vue";
import { useComposerStore } from "../../stores/composerStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useImagesStore } from "../../stores/imagesStore";
import ComposerAttachmentList from "./ComposerAttachmentList.vue";
import ComposerParameterBar from "./ComposerParameterBar.vue";
import PromptInputBox from "./PromptInputBox.vue";

defineProps<{
  isDragActive: boolean;
}>();

const emit = defineEmits<{
  closeAllEditors: [];
  removeAttachment: [id: string];
  "update:editModeEnabled": [value: boolean];
}>();

const composer = useComposerStore();
const generation = useGenerationStore();
const images = useImagesStore();
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
    <form class="mx-auto max-w-3xl" @submit.prevent="generation.submitMessage">
      <ComposerAttachmentList
        :active-attachments="images.activeAttachments"
        :active-edit-mask-image-id="composer.activeEditMaskImageId"
        :active-edit-source-image-id="composer.activeEditSourceImageId"
        @remove-attachment="emit('removeAttachment', $event)"
      />

      <PromptInputBox
        ref="promptInputRef"
        :active-attachment-count="images.activeAttachments.length"
        :can-send="generation.canSend"
        :composer-text="composer.composerText"
        :is-drag-active="isDragActive"
        :is-generating="generation.isGenerating"
        @import-images="images.importImages"
        @submit-message="generation.submitMessage"
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
