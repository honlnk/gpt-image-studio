<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  activeAttachmentCount: number;
  canSend: boolean;
  composerText: string;
  isDragActive: boolean;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  importImages: [files: File[]];
  submitMessage: [];
  "update:composerText": [value: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const composerPlaceholder = computed(() =>
  props.activeAttachmentCount
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
    <div class="flex items-end justify-between">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <label
          class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
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
        <slot />
      </div>
      <button
        class="ml-1.5 shrink-0 cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!canSend"
        type="submit"
      >
        {{ isGenerating ? "继续发送" : "发送" }}
      </button>
    </div>
  </div>
</template>
