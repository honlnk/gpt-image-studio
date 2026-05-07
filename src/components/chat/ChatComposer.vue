<script setup lang="ts">
import { computed, ref } from "vue";
import type { EditorKey, GenerationParams, ImageAsset } from "../../types/studio";

const props = defineProps<{
  activeAttachments: ImageAsset[];
  activeEditor: EditorKey | null;
  activeSizePreset: string;
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
  isEditorExpanded: boolean;
  isGenerating: boolean;
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
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const composerPlaceholder = computed(() =>
  props.activeAttachments.length
    ? "描述你想基于引用图修改什么..."
    : "描述你想生成的图片...",
);

function focusComposer() {
  textareaRef.value?.focus();
}

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

defineExpose({ focusComposer });
</script>

<template>
  <div
    class="border-t border-gray-200 bg-white px-4 py-3"
    @click="emit('closeAllEditors')"
  >
    <form class="mx-auto max-w-3xl" @submit.prevent="emit('submitMessage')">
      <div
        :class="[
          'editor-collapse mb-2',
          isEditorExpanded ? 'editor-collapse--open' : '',
        ]"
        @click.stop
      >
        <div class="editor-collapse__inner">
          <div
            v-if="activeEditor === 'size'"
            class="flex flex-wrap items-center gap-1.5"
          >
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
              {{
                preset === "custom"
                  ? "自定义"
                  : preset === "auto"
                    ? "自动"
                    : preset
              }}
            </button>
            <div
              v-if="activeSizePreset === 'custom'"
              class="flex items-center gap-2"
            >
              <input
                :value="imageWidth"
                class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
                type="number"
                min="16"
                max="3840"
                step="16"
                placeholder="宽"
                @input="
                  emit(
                    'update:imageWidth',
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
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
                @input="
                  emit(
                    'update:imageHeight',
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
              />
            </div>
            <p v-if="customSizeError" class="basis-full pt-1 text-xs text-red-500">
              {{ customSizeError }}
            </p>
          </div>

          <div
            v-if="activeEditor === 'quality'"
            class="flex flex-wrap items-center gap-1.5"
          >
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

          <div
            v-if="activeEditor === 'background'"
            class="flex flex-wrap items-center gap-1.5"
          >
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

          <div
            v-if="activeEditor === 'format'"
            class="flex flex-wrap items-center gap-1.5"
          >
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

      <div class="mb-2 flex flex-wrap items-center gap-1.5" @click.stop>
        <span
          class="cursor-not-allowed rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400"
        >
          模型: {{ model }}
        </span>
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

      <div v-if="activeAttachments.length" class="mb-2 flex flex-wrap gap-2">
        <div
          v-for="image in activeAttachments"
          :key="image.id"
          class="flex max-w-55 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-sm"
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
            aria-label="移除引用图片"
            @click="emit('removeAttachment', image.id)"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div
        :class="[
          'rounded-2xl border bg-white px-3 py-2 shadow-sm transition-all focus-within:border-gray-400 focus-within:shadow-md',
          isDragActive
            ? 'border-gray-500 ring-2 ring-gray-200'
            : 'border-gray-300',
        ]"
      >
        <label class="sr-only" for="composerText">输入图片需求</label>
        <textarea
          id="composerText"
          ref="textareaRef"
          :value="composerText"
          class="max-h-40 w-full resize-none bg-transparent py-1 text-[15px] leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
          :placeholder="composerPlaceholder"
          rows="2"
          @input="
            autoResize($event);
            emit(
              'update:composerText',
              ($event.target as HTMLTextAreaElement).value,
            );
          "
          @keydown="handleComposerKeydown"
          @paste="importFromPaste"
        />
        <div class="flex items-center justify-between">
          <label
            class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            aria-label="上传图片"
            title="上传图片"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
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
            :disabled="!canSend || isGenerating"
            type="submit"
          >
            {{ isGenerating ? "生成中" : "发送" }}
          </button>
        </div>
      </div>
    </form>
  </div>
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
