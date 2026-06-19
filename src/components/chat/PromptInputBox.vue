<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { track } from "../../features/analytics/useAnalyticsTracker";
import { useSettingsStore } from "../../stores/settingsStore";
import type { FavoritePrompt } from "../../types/studio";

const props = defineProps<{
  activeAttachmentCount: number;
  canSend: boolean;
  composerText: string;
  isDragActive: boolean;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  importImages: [files: File[]];
  openFavoritePromptSettings: [];
  submitMessage: [];
  "update:composerText": [value: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const promptMenuRef = ref<HTMLDivElement | null>(null);
const promptMenuListRef = ref<HTMLDivElement | null>(null);
const promptOptionRefs = ref<HTMLElement[]>([]);
const settings = useSettingsStore();
const isPromptMenuOpen = ref(false);
const activePromptIndex = ref(0);
const promptQuery = ref("");
const promptTriggerStart = ref(-1);
const promptMenuStyle = ref<Record<string, string>>({});
const ignoreNextTextareaClick = ref(false);
const PROMPT_MENU_MAX_HEIGHT = 256;

const composerPlaceholder = computed(() =>
  props.activeAttachmentCount
    ? "描述你想基于引用图修改什么... 输入 @ 可插入常用提示词"
    : "描述你想生成的图片... 输入 @ 可插入常用提示词",
);
const filteredFavoritePrompts = computed(() => {
  const query = promptQuery.value.trim().toLocaleLowerCase();
  const prompts = settings.favoritePrompts;
  if (!query) return prompts;

  return prompts.filter((prompt) => {
    const title = prompt.title.toLocaleLowerCase();
    const text = prompt.text.toLocaleLowerCase();
    return title.includes(query) || text.includes(query);
  });
});

watch(isPromptMenuOpen, (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  } else {
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
});

function focusComposer() {
  textareaRef.value?.focus();
}

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function autoResize(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  resizeTextarea(el);
  if (isPromptMenuOpen.value) updatePromptMenuFromTextarea(el);
}

watch(
  () => props.composerText,
  () => {
    void nextTick(() => {
      const el = textareaRef.value;
      if (!el) return;

      resizeTextarea(el);
      updatePromptMenuFromTextarea(el);
    });
  },
  { flush: "post" },
);

function handleComposerKeydown(event: KeyboardEvent) {
  if (isPromptMenuOpen.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActivePrompt(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActivePrompt(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectActivePrompt();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePromptMenu();
      return;
    }
  }

  if (event.key !== "Enter" || event.isComposing) return;
  if (event.shiftKey) return;

  event.preventDefault();
  if (props.canSend) {
    emit("submitMessage");
  }
}

function handleComposerInput(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  ignoreNextTextareaClick.value = false;
  autoResize(event);
  emit("update:composerText", el.value);
  updatePromptMenuFromTextarea(el);
}

function handleComposerClick() {
  if (ignoreNextTextareaClick.value) {
    ignoreNextTextareaClick.value = false;
    return;
  }
  updatePromptMenuFromTextarea();
}

function updatePromptMenuFromTextarea(el = textareaRef.value) {
  if (!el) return;

  const mention = findPromptMention(el.value, el.selectionStart);
  if (!mention) {
    closePromptMenu();
    return;
  }

  promptTriggerStart.value = mention.start;
  promptQuery.value = mention.query;
  activePromptIndex.value = 0;
  isPromptMenuOpen.value = filteredFavoritePrompts.value.length > 0;
  if (isPromptMenuOpen.value) {
    positionPromptMenu(el);
  }
}

function positionPromptMenu(el: HTMLTextAreaElement) {
  const rect = getCaretRect(el);
  promptMenuStyle.value = getCaretMenuStyle(rect);

  void nextTick(() => {
    const menuHeight = promptMenuRef.value?.offsetHeight;
    if (!menuHeight) return;
    promptMenuStyle.value = getCaretMenuStyle(rect, menuHeight);
  });
}

function closePromptMenu() {
  isPromptMenuOpen.value = false;
  promptQuery.value = "";
  promptTriggerStart.value = -1;
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (promptMenuRef.value?.contains(target)) return;
  ignoreNextTextareaClick.value = Boolean(textareaRef.value?.contains(target));
  closePromptMenu();
}

function moveActivePrompt(delta: number) {
  const prompts = filteredFavoritePrompts.value;
  if (!prompts.length) return;

  activePromptIndex.value =
    (activePromptIndex.value + delta + prompts.length) % prompts.length;
  void nextTick(scrollActivePromptIntoView);
}

function scrollActivePromptIntoView() {
  const listEl = promptMenuListRef.value;
  const optionEl = promptOptionRefs.value[activePromptIndex.value];
  if (!listEl || !optionEl) return;

  const targetScrollTop =
    optionEl.offsetTop - (listEl.clientHeight - optionEl.offsetHeight) / 2;
  listEl.scrollTo({
    top: Math.max(0, targetScrollTop),
    behavior: "smooth",
  });
}

function setPromptOptionRef(el: unknown, index: number) {
  if (el instanceof HTMLElement) {
    promptOptionRefs.value[index] = el;
  } else {
    promptOptionRefs.value.splice(index, 1);
  }
}

function selectActivePrompt() {
  const prompt = filteredFavoritePrompts.value[activePromptIndex.value];
  if (prompt) insertFavoritePrompt(prompt);
}

function openFavoritePromptSettings() {
  closePromptMenu();
  emit("openFavoritePromptSettings");
}

function insertFavoritePrompt(prompt: FavoritePrompt) {
  const el = textareaRef.value;
  if (!el || promptTriggerStart.value < 0) return;

  const start = promptTriggerStart.value;
  const end = el.selectionStart;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const insertText = `${needsLeadingSpace ? " " : ""}${prompt.text}${needsTrailingSpace ? " " : ""}`;
  const nextValue = before + insertText + after;
  const nextCaret = before.length + insertText.length;

  emit("update:composerText", nextValue);
  closePromptMenu();
  void nextTick(() => {
    el.value = nextValue;
    el.selectionStart = nextCaret;
    el.selectionEnd = nextCaret;
    autoResize({ target: el } as unknown as Event);
    el.focus();
  });
}

function findPromptMention(value: string, caretIndex: number) {
  const beforeCaret = value.slice(0, caretIndex);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) return null;

  const query = beforeCaret.slice(atIndex + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: atIndex, query };
}

function getCaretMenuStyle(rect: DOMRect, menuHeight = PROMPT_MENU_MAX_HEIGHT) {
  const anchorY = rect.top + rect.height;
  const top = anchorY - menuHeight;
  const left = Math.min(rect.left, window.innerWidth - 288);

  return {
    left: `${Math.max(12, left)}px`,
    top: `${Math.max(12, top)}px`,
  };
}

function getCaretRect(el: HTMLTextAreaElement) {
  const selectionEnd = el.selectionEnd;
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  const span = document.createElement("span");
  const rect = el.getBoundingClientRect();

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top - el.scrollTop}px`;
  mirror.style.width = `${el.clientWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.border = style.border;
  mirror.style.padding = style.padding;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.boxSizing = style.boxSizing;
  mirror.textContent = el.value.slice(0, selectionEnd);
  span.textContent = el.value.slice(selectionEnd) || ".";
  mirror.appendChild(span);
  document.body.appendChild(mirror);

  const spanRect = span.getBoundingClientRect();
  document.body.removeChild(mirror);
  return spanRect;
}

function importFromInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) {
    track("chat.attach_image", { source: "select", count: files.length }, "ui_input");
  }
  emit("importImages", files);
  input.value = "";
}

function importFromPaste(event: ClipboardEvent) {
  const files = imageFilesFromTransfer(
    event.clipboardData?.files,
    event.clipboardData?.items,
  );

  if (!files.length) return;
  event.preventDefault();
  track("chat.attach_image", { source: "paste", count: files.length }, "ui_input");
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
      'relative rounded-2xl border bg-white px-3 py-2 shadow-sm transition-all focus-within:border-gray-400 focus-within:shadow-md',
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
        handleComposerInput($event);
      "
      @keydown="handleComposerKeydown"
      @click="handleComposerClick"
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
        v-track="'chat.submit'"
        class="ml-1.5 shrink-0 cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
        :disabled="!canSend"
        type="submit"
      >
        {{ isGenerating ? "继续发送" : "发送" }}
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="isPromptMenuOpen"
        ref="promptMenuRef"
        class="fixed z-70 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        :style="promptMenuStyle"
      >
        <div
          class="flex items-center justify-between border-b border-gray-100 bg-white px-3 py-2"
        >
          <span class="text-xs font-medium text-gray-500">
            常用提示词
          </span>
          <button
            class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="管理常用提示词"
            title="管理常用提示词"
            type="button"
            @mousedown.prevent="openFavoritePromptSettings"
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
        </div>
        <div
          ref="promptMenuListRef"
          class="max-h-56 overflow-y-auto py-1"
        >
          <button
            v-for="(prompt, index) in filteredFavoritePrompts"
            :key="prompt.id"
            :ref="(el) => setPromptOptionRef(el, index)"
            class="block w-full cursor-pointer px-3 py-2 text-left transition-colors"
            :class="index === activePromptIndex ? 'bg-gray-100' : 'hover:bg-gray-50'"
            type="button"
            @mousedown.prevent="insertFavoritePrompt(prompt)"
            @mouseenter="activePromptIndex = index"
          >
            <span class="block truncate text-sm font-medium text-gray-800">
              {{ prompt.title }}
            </span>
            <span class="line-clamp-2 text-xs leading-relaxed text-gray-500">
              {{ prompt.text }}
            </span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
