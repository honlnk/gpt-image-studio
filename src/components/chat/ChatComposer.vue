<script setup lang="ts">
import { ref } from "vue";
import type {
  EditorKey,
  GenerationParams,
  ImageAsset,
  SizeRatio,
  SizeResolution,
} from "../../types/studio";
import ComposerAttachmentList from "./ComposerAttachmentList.vue";
import ComposerEditorPanel from "./ComposerEditorPanel.vue";
import ComposerParameterBar from "./ComposerParameterBar.vue";
import PromptInputBox from "./PromptInputBox.vue";

defineProps<{
  activeAttachments: ImageAsset[];
  activeEditMaskImageId: string;
  activeEditSourceImageId: string;
  activeEditor: EditorKey | null;
  activeSizePreset: GenerationParams["size"];
  background: string;
  backgroundLabel: string;
  backgroundOptions: readonly { value: string; label: string }[];
  canSend: boolean;
  composerText: string;
  customSizeError: string;
  formatLabel: string;
  formatOptions: readonly { value: string; label: string }[];
  imageHeight: number;
  imageWidth: number;
  isDragActive: boolean;
  isGenerating: boolean;
  model: string;
  editModeEnabled: boolean;
  outputFormat: string;
  quality: string;
  qualityLabel: string;
  qualityOptions: readonly { value: string; label: string }[];
  sizeLabel: string;
  sizeRatioOptions: readonly {
    value: SizeRatio;
    label: string;
    widthRatio: number;
    heightRatio: number;
  }[];
  sizeResolution: SizeResolution;
  sizeResolutionOptions: readonly { value: SizeResolution; label: string }[];
}>();

const emit = defineEmits<{
  applySizePreset: [preset: GenerationParams["size"]];
  applySizeResolution: [resolution: SizeResolution];
  closeAllEditors: [];
  importImages: [files: File[]];
  removeAttachment: [id: string];
  submitMessage: [];
  toggleEditor: [key: EditorKey];
  "update:background": [value: string];
  "update:composerText": [value: string];
  "update:imageHeight": [value: number];
  "update:imageWidth": [value: number];
  "update:outputFormat": [value: string];
  "update:quality": [value: string];
  "update:editModeEnabled": [value: boolean];
}>();

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
        :active-edit-mask-image-id="activeEditMaskImageId"
        :active-edit-source-image-id="activeEditSourceImageId"
        @remove-attachment="emit('removeAttachment', $event)"
      />

      <PromptInputBox
        ref="promptInputRef"
        :active-attachment-count="activeAttachments.length"
        :can-send="canSend"
        :composer-text="composerText"
        :is-drag-active="isDragActive"
        :is-generating="isGenerating"
        @import-images="emit('importImages', $event)"
        @submit-message="emit('submitMessage')"
        @update:composer-text="emit('update:composerText', $event)"
      >
        <div class="relative min-w-0 flex-1" @click.stop>
          <ComposerParameterBar
            :active-editor="activeEditor"
            :background-label="backgroundLabel"
            :edit-mode-enabled="editModeEnabled"
            :format-label="formatLabel"
            :model="model"
            :quality-label="qualityLabel"
            :size-label="sizeLabel"
            @toggle-editor="emit('toggleEditor', $event)"
            @update:edit-mode-enabled="emit('update:editModeEnabled', $event)"
          >
            <template #size-editor>
              <ComposerEditorPanel
                :active-editor="activeEditor"
                :active-size-preset="activeSizePreset"
                :background="background"
                :background-options="backgroundOptions"
                :custom-size-error="customSizeError"
                :format-options="formatOptions"
                :image-height="imageHeight"
                :image-width="imageWidth"
                :output-format="outputFormat"
                :quality="quality"
                :quality-options="qualityOptions"
                :size-ratio-options="sizeRatioOptions"
                :size-resolution="sizeResolution"
                :size-resolution-options="sizeResolutionOptions"
                @apply-size-preset="emit('applySizePreset', $event)"
                @apply-size-resolution="emit('applySizeResolution', $event)"
                @update:background="emit('update:background', $event)"
                @update:image-height="emit('update:imageHeight', $event)"
                @update:image-width="emit('update:imageWidth', $event)"
                @update:output-format="emit('update:outputFormat', $event)"
                @update:quality="emit('update:quality', $event)"
              />
            </template>
            <template #quality-editor>
              <ComposerEditorPanel
                :active-editor="activeEditor"
                :active-size-preset="activeSizePreset"
                :background="background"
                :background-options="backgroundOptions"
                :custom-size-error="customSizeError"
                :format-options="formatOptions"
                :image-height="imageHeight"
                :image-width="imageWidth"
                :output-format="outputFormat"
                :quality="quality"
                :quality-options="qualityOptions"
                :size-ratio-options="sizeRatioOptions"
                :size-resolution="sizeResolution"
                :size-resolution-options="sizeResolutionOptions"
                @apply-size-preset="emit('applySizePreset', $event)"
                @apply-size-resolution="emit('applySizeResolution', $event)"
                @update:background="emit('update:background', $event)"
                @update:image-height="emit('update:imageHeight', $event)"
                @update:image-width="emit('update:imageWidth', $event)"
                @update:output-format="emit('update:outputFormat', $event)"
                @update:quality="emit('update:quality', $event)"
              />
            </template>
            <template #background-editor>
              <ComposerEditorPanel
                :active-editor="activeEditor"
                :active-size-preset="activeSizePreset"
                :background="background"
                :background-options="backgroundOptions"
                :custom-size-error="customSizeError"
                :format-options="formatOptions"
                :image-height="imageHeight"
                :image-width="imageWidth"
                :output-format="outputFormat"
                :quality="quality"
                :quality-options="qualityOptions"
                :size-ratio-options="sizeRatioOptions"
                :size-resolution="sizeResolution"
                :size-resolution-options="sizeResolutionOptions"
                @apply-size-preset="emit('applySizePreset', $event)"
                @apply-size-resolution="emit('applySizeResolution', $event)"
                @update:background="emit('update:background', $event)"
                @update:image-height="emit('update:imageHeight', $event)"
                @update:image-width="emit('update:imageWidth', $event)"
                @update:output-format="emit('update:outputFormat', $event)"
                @update:quality="emit('update:quality', $event)"
              />
            </template>
            <template #format-editor>
              <ComposerEditorPanel
                :active-editor="activeEditor"
                :active-size-preset="activeSizePreset"
                :background="background"
                :background-options="backgroundOptions"
                :custom-size-error="customSizeError"
                :format-options="formatOptions"
                :image-height="imageHeight"
                :image-width="imageWidth"
                :output-format="outputFormat"
                :quality="quality"
                :quality-options="qualityOptions"
                :size-ratio-options="sizeRatioOptions"
                :size-resolution="sizeResolution"
                :size-resolution-options="sizeResolutionOptions"
                @apply-size-preset="emit('applySizePreset', $event)"
                @apply-size-resolution="emit('applySizeResolution', $event)"
                @update:background="emit('update:background', $event)"
                @update:image-height="emit('update:imageHeight', $event)"
                @update:image-width="emit('update:imageWidth', $event)"
                @update:output-format="emit('update:outputFormat', $event)"
                @update:quality="emit('update:quality', $event)"
              />
            </template>
          </ComposerParameterBar>
        </div>
      </PromptInputBox>
    </form>
  </div>
</template>
