<script setup lang="ts">
import { ref } from "vue";
import type {
  Conversation,
  EditorKey,
  GenerationParams,
  ImageAsset,
  Message,
} from "../../types/studio";

const props = defineProps<{
  activeAttachments: ImageAsset[];
  activeConversation?: Conversation;
  activeEditor: EditorKey | null;
  activeMessages: Message[];
  activeSizePreset: string;
  background: string;
  backgroundLabel: string;
  backgroundOptions: readonly { value: string; label: string }[];
  canSend: boolean;
  composerText: string;
  formatLabel: string;
  formatOptions: readonly { value: string; label: string }[];
  imageById: (id: string) => ImageAsset | undefined;
  imageHeight: number;
  imageWidth: number;
  isEditorExpanded: boolean;
  isLibraryOpen: boolean;
  model: string;
  outputFormat: string;
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
  importImages: [files: File[]];
  removeAttachment: [id: string];
  retryMessage: [message: Message];
  openSettings: [];
  submitMessage: [];
  toggleEditor: [key: EditorKey];
  "update:background": [value: string];
  "update:composerText": [value: string];
  "update:imageHeight": [value: number];
  "update:imageWidth": [value: number];
  "update:isLibraryOpen": [value: boolean];
  "update:outputFormat": [value: string];
  "update:quality": [value: string];
}>();

const isDragActive = ref(false);
let dragDepth = 0;

function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.shiftKey) return;

  event.preventDefault();
  if (props.canSend) {
    emit("submitMessage");
  }
}

function imageExtension(image?: ImageAsset) {
  if (image?.mimeType === "image/jpeg") return "jpeg";
  if (image?.mimeType === "image/webp") return "webp";
  return "png";
}

function importFromInput(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("importImages", Array.from(input.files ?? []));
  input.value = "";
}

function importFromPaste(event: ClipboardEvent) {
  const files = imageFilesFromTransfer(
    event.clipboardData?.files,
    event.clipboardData?.items,
  );

  if (!files.length) return;
  event.preventDefault();
  emit("importImages", files);
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
      <h1 class="truncate text-base font-semibold text-gray-800">
        {{ activeConversation?.title }}
      </h1>
      <div class="flex items-center gap-1">
        <button
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          aria-label="打开设置"
          type="button"
          @click="emit('openSettings')"
        >
          ⚙
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

    <!-- 消息流 -->
    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-[768px] px-4 py-6">
        <article
          v-for="message in activeMessages"
          :key="message.id"
          :class="[
            'mb-6 rounded-2xl px-5 py-4',
            message.role === 'user' ? 'bg-gray-50' : '',
            message.status === 'error' ? 'bg-red-50' : '',
          ]"
        >
          <div class="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
            <span class="font-semibold text-gray-700">
              {{ message.role === "user" ? "你" : "Image Studio" }}
            </span>
            <span>{{ message.createdAt }}</span>
          </div>

          <p class="text-[15px] leading-relaxed text-gray-800">
            {{ message.content }}
          </p>

          <!-- 引用图片 -->
          <div
            v-if="message.referencedImageIds.length"
            class="mt-3 flex flex-wrap gap-2"
          >
            <button
              v-for="imageId in message.referencedImageIds"
              :key="imageId"
              class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              type="button"
              @click="emit('attachImage', imageId)"
            >
              {{ imageById(imageId)?.name }}
            </button>
          </div>

          <!-- 生成中 -->
          <div v-if="message.status === 'pending'" class="mt-3">
            <span
              class="inline-flex items-center gap-1.5 text-sm text-gray-400"
            >
              <span
                class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"
              ></span>
              生成中...
            </span>
          </div>

          <!-- 生成结果 -->
          <div
            v-if="message.resultImageIds.length"
            class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <figure
              v-for="imageId in message.resultImageIds"
              :key="imageId"
              class="overflow-hidden rounded-xl border border-gray-200"
            >
              <div
                class="flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400"
              >
                <img
                  v-if="imageById(imageId)?.previewUrl"
                  class="h-full w-full object-contain"
                  :alt="imageById(imageId)?.name"
                  :src="imageById(imageId)?.previewUrl"
                />
                <span v-else>{{ imageById(imageId)?.name }}</span>
              </div>
              <figcaption class="flex items-center justify-between gap-3 px-3 py-2">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">
                    {{ imageById(imageId)?.name }}
                  </div>
                  <div class="truncate text-xs text-gray-500">
                    {{ imageById(imageId)?.prompt }}
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <a
                    v-if="imageById(imageId)?.previewUrl"
                    class="rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                    :download="`${imageById(imageId)?.name || 'image'}.${imageExtension(imageById(imageId))}`"
                    :href="imageById(imageId)?.previewUrl"
                  >
                    下载
                  </a>
                  <button
                    class="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                    type="button"
                    @click="emit('attachImage', imageId)"
                  >
                    引用
                  </button>
                </div>
              </figcaption>
            </figure>
          </div>

          <!-- 重试 -->
          <button
            v-if="message.status === 'error'"
            class="mt-3 cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            type="button"
            @click="emit('retryMessage', message)"
          >
            重试
          </button>
        </article>
      </div>
    </div>

    <!-- 输入区 -->
    <div
      class="border-t border-gray-200 bg-white px-4 py-3"
      @click="emit('closeAllEditors')"
    >
      <form
        class="mx-auto max-w-[768px]"
        @submit.prevent="emit('submitMessage')"
      >
        <!-- 编辑器区域 -->
        <div
          :class="[
            'editor-collapse mb-2',
            isEditorExpanded ? 'editor-collapse--open' : '',
          ]"
          @click.stop
        >
          <div class="editor-collapse__inner">
            <!-- 尺寸编辑器 -->
            <div v-if="activeEditor === 'size'" class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="preset in sizePresets"
                :key="preset"
                :class="[
                  'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                  activeSizePreset === preset
                    ? 'border-gray-400 bg-gray-100 text-gray-900'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                ]"
                type="button"
                @click="emit('applySizePreset', preset)"
              >
                {{ preset === 'custom' ? '自定义' : preset === 'auto' ? '自动' : preset }}
              </button>
              <div v-if="activeSizePreset === 'custom'" class="flex items-center gap-2">
                <input
                  :value="imageWidth"
                  class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
                  type="number"
                  min="16"
                  max="3840"
                  step="16"
                  placeholder="宽"
                  @input="emit('update:imageWidth', Number(($event.target as HTMLInputElement).value))"
                />
                <span class="text-xs text-gray-400">×</span>
                <input
                  :value="imageHeight"
                  class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
                  type="number"
                  min="16"
                  max="3840"
                  step="16"
                  placeholder="高"
                  @input="emit('update:imageHeight', Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>

            <!-- 质量编辑器 -->
            <div v-if="activeEditor === 'quality'" class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="opt in qualityOptions"
                :key="opt.value"
                :class="[
                  'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                  quality === opt.value
                    ? 'border-gray-400 bg-gray-100 text-gray-900'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                ]"
                type="button"
                @click="emit('update:quality', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- 背景编辑器 -->
            <div v-if="activeEditor === 'background'" class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="opt in backgroundOptions"
                :key="opt.value"
                :class="[
                  'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                  background === opt.value
                    ? 'border-gray-400 bg-gray-100 text-gray-900'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                ]"
                type="button"
                @click="emit('update:background', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- 格式编辑器 -->
            <div v-if="activeEditor === 'format'" class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="opt in formatOptions"
                :key="opt.value"
                :class="[
                  'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                  outputFormat === opt.value
                    ? 'border-gray-400 bg-gray-100 text-gray-900'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                ]"
                type="button"
                @click="emit('update:outputFormat', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 参数标签 -->
        <div class="mb-2 flex flex-wrap items-center gap-1.5" @click.stop>
          <span
            class="cursor-not-allowed rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400"
            >模型: {{ model }}</span
          >
          <button
            class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
            type="button"
            @click="emit('toggleEditor', 'size')"
          >
            尺寸: {{ sizeLabel }}
          </button>
          <button
            class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
            type="button"
            @click="emit('toggleEditor', 'quality')"
          >
            质量: {{ qualityLabel }}
          </button>
          <button
            class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
            type="button"
            @click="emit('toggleEditor', 'background')"
          >
            背景: {{ backgroundLabel }}
          </button>
          <button
            class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
            type="button"
            @click="emit('toggleEditor', 'format')"
          >
            格式: {{ formatLabel }}
          </button>
        </div>

        <!-- 附件预览 -->
        <div
          v-if="activeAttachments.length"
          class="mb-2 flex flex-wrap gap-2"
        >
          <div
            v-for="image in activeAttachments"
            :key="image.id"
            class="flex max-w-[220px] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-sm"
          >
            <img
              v-if="image.previewUrl"
              class="h-7 w-7 shrink-0 rounded object-cover"
              :alt="image.name"
              :src="image.previewUrl"
            />
            <span class="truncate text-gray-700">{{ image.name }}</span>
            <button
              class="shrink-0 cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
              type="button"
              @click="emit('removeAttachment', image.id)"
            >
              ×
            </button>
          </div>
        </div>

        <!-- 输入框 + 操作按钮 -->
        <div
          :class="[
            'rounded-2xl border bg-white px-3 py-2 shadow-sm transition-all focus-within:border-gray-400 focus-within:shadow-md',
            isDragActive ? 'border-gray-500 ring-2 ring-gray-200' : 'border-gray-300',
          ]"
        >
          <label class="sr-only" for="composerText">输入图片需求</label>
          <textarea
            id="composerText"
            ref="textareaRef"
            :value="composerText"
            class="max-h-[160px] w-full resize-none bg-transparent py-1 text-[15px] leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
            placeholder="描述你想生成的图片..."
            rows="2"
            @input="autoResize($event); emit('update:composerText', ($event.target as HTMLTextAreaElement).value)"
            @keydown="handleComposerKeydown"
            @paste="importFromPaste"
          />
          <div class="flex items-center justify-between">
            <label
              class="inline-flex items-center justify-center cursor-pointer rounded-lg w-8 h-8 text-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="上传图片"
              title="上传图片"
            >
              +
              <input
                class="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                @change="importFromInput"
              />
            </label>
            <button
              class="shrink-0 cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="!canSend"
              type="submit"
            >
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.editor-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease-out;
}

.editor-collapse--open {
  grid-template-rows: 1fr;
}

.editor-collapse__inner {
  overflow: hidden;
}
</style>
