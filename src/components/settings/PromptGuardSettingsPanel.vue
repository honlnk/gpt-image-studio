<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PROMPT_REWRITE_GUARD_PREFIX } from "../../services/imagesApi";
import type { PromptRewriteGuardHistoryItem } from "../../types/studio";

const props = defineProps<{
  enabled: boolean;
  text: string;
  history: PromptRewriteGuardHistoryItem[];
}>();

const emit = defineEmits<{
  "update:enabled": [value: boolean];
  saveText: [value: string];
  restoreDefault: [];
  restoreHistory: [id: string];
  deleteHistory: [id: string];
}>();

const draftText = ref(props.text);
const copiedId = ref("");
const hasChanges = computed(() => draftText.value !== props.text);
const sortedHistory = computed(() =>
  [...props.history].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  ),
);

watch(
  () => props.text,
  (text) => {
    draftText.value = text;
  },
);

function saveDraft() {
  emit("saveText", draftText.value);
}

function restoreDefault() {
  draftText.value = PROMPT_REWRITE_GUARD_PREFIX;
  emit("restoreDefault");
}

function restoreHistory(id: string) {
  const item = props.history.find((entry) => entry.id === id);
  if (item) draftText.value = item.text;
  emit("restoreHistory", id);
}

async function copyHistory(item: PromptRewriteGuardHistoryItem) {
  try {
    await navigator.clipboard.writeText(item.text);
    copiedId.value = item.id;
    window.setTimeout(() => {
      if (copiedId.value === item.id) copiedId.value = "";
    }, 1400);
  } catch {
    copiedId.value = "";
  }
}

function formatHistoryTime(dateString: string) {
  const timestamp = Date.parse(dateString);
  if (!Number.isFinite(timestamp)) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function isDefaultHistoryItem(item: PromptRewriteGuardHistoryItem) {
  return item.id === "prompt-guard-default" && item.text === PROMPT_REWRITE_GUARD_PREFIX;
}
</script>

<template>
  <section aria-labelledby="promptGuardSettingsTitle">
    <h3 id="promptGuardSettingsTitle" class="text-base font-semibold text-gray-900">
      提示词保护
    </h3>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      当前设置只会影响发送给图片接口的请求文本，不会改写聊天记录里的原始提示词。
    </p>

    <div class="mt-4 space-y-4">
      <div class="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-3 py-2.5">
        <div>
          <div class="text-sm font-medium text-gray-700">启用提示词防改写</div>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            开启后，请求会在用户提示词前追加下面的前置指令。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="enabled"
          :class="[
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-gray-900' : 'bg-gray-300',
          ]"
          @click="emit('update:enabled', !enabled)"
        >
          <span
            :class="[
              'inline-block h-4 w-4 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0.5',
            ]"
          />
        </button>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between gap-3">
          <label class="text-sm font-medium text-gray-700" for="promptGuardText">
            当前前置指令
          </label>
          <button
            class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            type="button"
            @click="restoreDefault"
          >
            恢复默认
          </button>
        </div>
        <textarea
          id="promptGuardText"
          v-model="draftText"
          class="h-20 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-gray-900 outline-none transition-colors focus:border-gray-500"
          spellcheck="false"
        />
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-xs text-gray-500">
            文本为空时会自动使用默认英文指令。
          </p>
          <button
            class="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!hasChanges"
            @click="saveDraft"
          >
            保存为当前版本
          </button>
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-700">历史版本</h4>
          <span class="text-xs text-gray-400">{{ history.length }} 条</span>
        </div>
        <div
          v-if="!sortedHistory.length"
          class="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400"
        >
          还没有保存过历史版本
        </div>
        <div v-else class="space-y-2">
          <article
            v-for="item in sortedHistory"
            :key="item.id"
            class="rounded-lg border border-gray-200 px-3 py-2.5"
          >
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <span v-if="isDefaultHistoryItem(item)" class="text-xs text-gray-400">
                默认版本
              </span>
              <time v-else class="text-xs text-gray-400">
                {{ formatHistoryTime(item.createdAt) }}
              </time>
              <div class="flex items-center gap-1">
                <button
                  class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  type="button"
                  @click="restoreHistory(item.id)"
                >
                  恢复
                </button>
                <button
                  class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  type="button"
                  @click="copyHistory(item)"
                >
                  {{ copiedId === item.id ? "已复制" : "复制" }}
                </button>
                <button
                  class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  type="button"
                  @click="emit('deleteHistory', item.id)"
                >
                  删除
                </button>
              </div>
            </div>
            <p class="line-clamp-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-600">
              {{ item.text }}
            </p>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
