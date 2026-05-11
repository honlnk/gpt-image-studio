<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type {
  Conversation,
  EditorKey,
  GenerationParams,
  ImageAsset,
  Message,
} from "../../types/studio";
import ChatComposer from "../chat/ChatComposer.vue";
import EditMaskModal from "../chat/EditMaskModal.vue";
import MessageList from "../chat/MessageList.vue";

const props = defineProps<{
  activeAttachments: ImageAsset[];
  activeConversation?: Conversation;
  activeEditMaskImageId: string;
  activeEditSourceImageId: string;
  activeEditor: EditorKey | null;
  activeMessages: Message[];
  activeSizePreset: string;
  background: string;
  backgroundLabel: string;
  backgroundOptions: readonly { value: string; label: string }[];
  canSend: boolean;
  composerText: string;
  createMaskAsset: (sourceImage: ImageAsset, maskBlob: Blob) => Promise<ImageAsset>;
  customSizeError: string;
  editModeEnabled: boolean;
  formatLabel: string;
  formatOptions: readonly { value: string; label: string }[];
  imageById: (id: string) => ImageAsset | undefined;
  imageHeight: number;
  imageWidth: number;
  isEditorExpanded: boolean;
  isGenerating: boolean;
  isLibraryOpen: boolean;
  model: string;
  outputFormat: string;
  pendingJobCount: number;
  quality: string;
  qualityLabel: string;
  qualityOptions: readonly { value: string; label: string }[];
  sizeLabel: string;
  sizePresets: readonly GenerationParams["size"][];
}>();

const emit = defineEmits<{
  applySizePreset: [preset: GenerationParams["size"]];
  attachImage: [id: string];
  closeAllEditors: [];
  openConversations: [];
  importImages: [files: File[]];
  removeAttachment: [id: string];
  applyEditSelection: [sourceImageId: string, maskImageId: string];
  retryMessage: [message: Message];
  openSettings: [];
  previewImage: [id: string];
  submitMessage: [];
  toggleEditor: [key: EditorKey];
  "update:background": [value: string];
  "update:composerText": [value: string];
  "update:imageHeight": [value: number];
  "update:imageWidth": [value: number];
  "update:isLibraryOpen": [value: boolean];
  "update:outputFormat": [value: string];
  "update:quality": [value: string];
  "update:editModeEnabled": [value: boolean];
}>();

const isDragActive = ref(false);
const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null);
const selectingImageId = ref("");
let dragDepth = 0;

const activeAttachmentIds = computed(() =>
  props.activeAttachments.map((image) => image.id),
);

function isImageAttached(id: string) {
  return props.activeAttachments.some((image) => image.id === id);
}

async function continueEdit(imageId: string) {
  if (!props.editModeEnabled) {
    if (!isImageAttached(imageId)) {
      emit("attachImage", imageId);
    }

    await nextTick();
    composerRef.value?.focusComposer();
    return;
  }

  selectingImageId.value = imageId;
}

async function applyMask(maskBlob: Blob) {
  const source = props.imageById(selectingImageId.value);
  if (!source) {
    selectingImageId.value = "";
    return;
  }

  const maskAsset = await props.createMaskAsset(source, maskBlob);
  emit("applyEditSelection", source.id, maskAsset.id);
  selectingImageId.value = "";
  await nextTick();
  composerRef.value?.focusComposer();
}

function closeMaskModal() {
  selectingImageId.value = "";
}

function importFromDrop(event: DragEvent) {
  resetDragState();
  const files = imageFilesFromTransfer(
    event.dataTransfer?.files,
    event.dataTransfer?.items,
  );

  if (!files.length) return;
  emit("importImages", files);
}

function handleDragEnter(event: DragEvent) {
  if (!hasImageTransfer(event)) return;
  dragDepth += 1;
  isDragActive.value = true;
}

function handleDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    isDragActive.value = false;
  }
}

function resetDragState() {
  dragDepth = 0;
  isDragActive.value = false;
}

function hasImageTransfer(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  const items = Array.from(event.dataTransfer?.items ?? []);

  return (
    types.includes("Files") &&
    (!items.length || items.some((item) => item.type.startsWith("image/")))
  );
}

function imageFilesFromTransfer(
  fileList?: FileList | null,
  itemList?: DataTransferItemList | null,
) {
  const files = Array.from(fileList ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );

  if (files.length) return files;

  return Array.from(itemList ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
</script>

<template>
  <section
    class="relative flex min-w-0 flex-1 flex-col"
    aria-label="聊天工作区"
    @dragenter.prevent="handleDragEnter"
    @dragleave.prevent="handleDragLeave"
    @dragover.prevent
    @drop.prevent="importFromDrop"
  >
    <div
      v-if="isDragActive"
      class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-white/85 backdrop-blur-sm"
    >
      <div class="rounded-2xl border border-dashed border-gray-400 bg-white px-8 py-6 text-center shadow-xl">
        <div class="text-base font-semibold text-gray-900">松开以上传图片</div>
        <div class="mt-1 text-sm text-gray-500">图片会保存到图片库，并作为下一条消息的引用图</div>
      </div>
    </div>

    <header
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          class="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          type="button"
          @click="emit('openConversations')"
        >
          会话
        </button>
        <h1 class="truncate text-base font-semibold text-gray-800">
          {{ activeConversation?.title || '新的对话' }}
        </h1>
      </div>
      <div class="flex items-center gap-1">
        <span
          v-if="pendingJobCount > 0"
          class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
        >
          正在生成 {{ pendingJobCount }} 张
        </span>
        <a
          href="https://github.com/honlnk/gpt-image-studio"
          target="_blank"
          rel="noopener noreferrer"
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="GitHub 仓库"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <button
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          aria-label="打开设置"
          type="button"
          @click="emit('openSettings')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          class="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          type="button"
          @click="emit('update:isLibraryOpen', !isLibraryOpen)"
        >
          {{ isLibraryOpen ? "隐藏图片库" : "图片库" }}
        </button>
      </div>
    </header>

    <MessageList
      :attached-image-ids="activeAttachmentIds"
      :image-by-id="imageById"
      :messages="activeMessages"
      @attach-image="emit('attachImage', $event)"
      @continue-edit="continueEdit"
      @preview-image="emit('previewImage', $event)"
      @retry-message="emit('retryMessage', $event)"
    />

    <ChatComposer
      ref="composerRef"
      :active-attachments="activeAttachments"
      :active-edit-mask-image-id="activeEditMaskImageId"
      :active-edit-source-image-id="activeEditSourceImageId"
      :active-editor="activeEditor"
      :active-size-preset="activeSizePreset"
      :background="background"
      :background-label="backgroundLabel"
      :background-options="backgroundOptions"
      :can-send="canSend"
      :composer-text="composerText"
      :custom-size-error="customSizeError"
      :edit-mode-enabled="editModeEnabled"
      :format-label="formatLabel"
      :format-options="formatOptions"
      :image-height="imageHeight"
      :image-width="imageWidth"
      :is-drag-active="isDragActive"
      :is-editor-expanded="isEditorExpanded"
      :is-generating="isGenerating"
      :model="model"
      :output-format="outputFormat"
      :quality="quality"
      :quality-label="qualityLabel"
      :quality-options="qualityOptions"
      :size-label="sizeLabel"
      :size-presets="sizePresets"
      @apply-size-preset="emit('applySizePreset', $event)"
      @close-all-editors="emit('closeAllEditors')"
      @import-images="emit('importImages', $event)"
      @remove-attachment="emit('removeAttachment', $event)"
      @submit-message="emit('submitMessage')"
      @toggle-editor="emit('toggleEditor', $event)"
      @update:background="emit('update:background', $event)"
      @update:composer-text="emit('update:composerText', $event)"
      @update:image-height="emit('update:imageHeight', $event)"
      @update:image-width="emit('update:imageWidth', $event)"
      @update:output-format="emit('update:outputFormat', $event)"
      @update:quality="emit('update:quality', $event)"
      @update:edit-mode-enabled="emit('update:editModeEnabled', $event)"
    />

    <EditMaskModal
      :image="selectingImageId ? imageById(selectingImageId) : undefined"
      @close="closeMaskModal"
      @apply="applyMask"
    />
  </section>
</template>
