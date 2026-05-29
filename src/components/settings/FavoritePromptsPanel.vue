<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FavoritePrompt } from "../../types/studio";

const props = defineProps<{
  prompts: FavoritePrompt[];
}>();

const emit = defineEmits<{
  addPrompt: [value: { title: string; text: string }];
  updatePrompt: [id: string, value: { title: string; text: string }];
  deletePrompt: [id: string];
}>();

const editingId = ref<string | null>(null);
const draftTitle = ref("");
const draftText = ref("");

const sortedPrompts = computed(() =>
  [...props.prompts].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  ),
);
const isEditingExisting = computed(() => Boolean(editingId.value));
const canSave = computed(() => draftText.value.trim().length > 0);

watch(
  () => props.prompts,
  (prompts) => {
    if (!editingId.value) return;
    if (prompts.some((item) => item.id === editingId.value)) return;
    resetDraft();
  },
  { deep: true },
);

function startCreate() {
  editingId.value = null;
  draftTitle.value = "";
  draftText.value = "";
}

function startEdit(prompt: FavoritePrompt) {
  editingId.value = prompt.id;
  draftTitle.value = prompt.title;
  draftText.value = prompt.text;
}

function saveDraft() {
  if (!canSave.value) return;

  const value = {
    title: draftTitle.value,
    text: draftText.value,
  };

  if (editingId.value) {
    emit("updatePrompt", editingId.value, value);
  } else {
    emit("addPrompt", value);
  }
  resetDraft();
}

function resetDraft() {
  editingId.value = null;
  draftTitle.value = "";
  draftText.value = "";
}

function formatUpdatedAt(dateString: string) {
  const timestamp = Date.parse(dateString);
  if (!Number.isFinite(timestamp)) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col"
    aria-labelledby="favoritePromptsSettingsTitle"
  >
    <div class="flex shrink-0 items-start justify-between gap-3">
      <div>
        <h3
          id="favoritePromptsSettingsTitle"
          class="text-base font-semibold text-gray-900"
        >
          常用提示词
        </h3>
        <p class="mt-1 text-sm leading-relaxed text-gray-500">
          在输入框输入 @ 后，可以用上下键选择，按空格或回车插入。
        </p>
      </div>
      <button
        class="shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        type="button"
        @click="startCreate"
      >
        新建
      </button>
    </div>

    <div class="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="min-h-0 space-y-2 overflow-y-auto pr-1">
        <div
          v-if="!sortedPrompts.length"
          class="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400"
        >
          还没有常用提示词
        </div>

        <article
          v-for="prompt in sortedPrompts"
          :key="prompt.id"
          class="rounded-lg border border-gray-200 px-3 py-2.5"
        >
          <div class="mb-1.5 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h4 class="truncate text-sm font-medium text-gray-800">
                {{ prompt.title }}
              </h4>
              <time class="text-xs text-gray-400">
                {{ formatUpdatedAt(prompt.updatedAt) }}
              </time>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                type="button"
                @click="startEdit(prompt)"
              >
                编辑
              </button>
              <button
                class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                type="button"
                @click="emit('deletePrompt', prompt.id)"
              >
                删除
              </button>
            </div>
          </div>
          <p
            class="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600"
          >
            {{ prompt.text }}
          </p>
        </article>
      </div>

      <form
        class="flex h-80 flex-col rounded-lg border border-gray-200 bg-white p-3 lg:self-start"
        @submit.prevent="saveDraft"
      >
        <h4 class="text-sm font-medium text-gray-800">
          {{ isEditingExisting ? "编辑提示词" : "新增提示词" }}
        </h4>
        <div class="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-gray-500" for="favoritePromptTitle">
              名称
            </label>
            <input
              id="favoritePromptTitle"
              v-model="draftTitle"
              class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
              placeholder="例如：产品摄影"
              type="text"
            />
          </div>
          <div class="flex min-h-0 flex-1 flex-col">
            <label class="mb-1 block text-xs font-medium text-gray-500" for="favoritePromptText">
              提示词
            </label>
            <textarea
              id="favoritePromptText"
              v-model="draftText"
              class="min-h-0 flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none transition-colors focus:border-gray-500"
              placeholder="输入要复用的提示词内容"
            />
          </div>
        </div>
        <div class="mt-3 flex shrink-0 justify-end gap-2">
          <button
            class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            type="button"
            @click="resetDraft"
          >
            取消
          </button>
          <button
            class="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSave"
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
