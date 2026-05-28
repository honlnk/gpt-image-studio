<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  PromptMode,
  PromptWordbankSectionKey,
  PromptWordbanks,
} from "../../types/studio";

const props = defineProps<{
  modelValue: PromptMode;
  wordbanks: PromptWordbanks;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: PromptMode];
  saveWordbank: [section: PromptWordbankSectionKey, terms: string[]];
  restoreDefaultWordbank: [section: PromptWordbankSectionKey];
}>();

const options: Array<{
  value: PromptMode;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "默认",
    description: "不追加任何模式指令，保持当前逻辑。",
  },
  {
    value: "safe",
    label: "安全",
    description: "只使用安全词库，强化干净、稳定的画面表达。",
  },
  {
    value: "creative",
    label: "创意",
    description: "使用安全 + 创意词库，强化氛围和画面张力。",
  },
  {
    value: "adult",
    label: "开放",
    description: "使用安全 + 创意 + 开放词库，适合更自由的模型或接口。",
  },
];

const wordbankSections: Array<{
  key: PromptWordbankSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: "pose.safe",
    label: "安全词库",
    description: "安全模式会从这里抽取词。",
  },
  {
    key: "pose.creative",
    label: "创意词库",
    description: "创意模式会叠加这里的词。",
  },
  {
    key: "pose.nsfw",
    label: "开放词库",
    description: "开放模式会继续叠加这里的词。",
  },
  {
    key: "adultInspiration",
    label: "开放灵感",
    description: "开放模式额外抽取的氛围灵感词。",
  },
];

const activeSection = ref<PromptWordbankSectionKey>("pose.safe");
const draftText = ref("");
const searchText = ref("");

const activeSectionMeta = computed(
  () =>
    wordbankSections.find((section) => section.key === activeSection.value) ??
    wordbankSections[0],
);
const activeTerms = computed(() =>
  getWordbankTerms(props.wordbanks, activeSection.value),
);
const parsedDraftTerms = computed(() => parseTerms(draftText.value));
const hasChanges = computed(
  () => termsSignature(parsedDraftTerms.value) !== termsSignature(activeTerms.value),
);
const filteredTerms = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  if (!query) return activeTerms.value;
  return activeTerms.value.filter((term) => term.toLowerCase().includes(query));
});

watch(
  [() => props.wordbanks, activeSection],
  () => {
    draftText.value = activeTerms.value.join("\n");
    searchText.value = "";
  },
  { immediate: true },
);

function saveDraft() {
  emit("saveWordbank", activeSection.value, parsedDraftTerms.value);
}

function restoreDefault() {
  emit("restoreDefaultWordbank", activeSection.value);
}

function parseTerms(text: string) {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !term.startsWith("#"))
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    });
}

function termsSignature(terms: readonly string[]) {
  return terms.join("\n");
}

function getWordbankTerms(wordbanks: PromptWordbanks, section: PromptWordbankSectionKey) {
  if (section === "pose.safe") return wordbanks.pose.safe;
  if (section === "pose.creative") return wordbanks.pose.creative;
  if (section === "pose.nsfw") return wordbanks.pose.nsfw;
  return wordbanks.adultInspiration;
}
</script>

<template>
  <section aria-labelledby="promptModeSettingsTitle" class="space-y-6">
    <div>
      <h3 id="promptModeSettingsTitle" class="text-base font-semibold text-gray-900">
        提示词模式
      </h3>
      <p class="mt-1 text-sm leading-relaxed text-gray-500">
        当前设置只影响发送给图片接口的请求文本，不会改写聊天记录里的原始提示词。
      </p>
    </div>

    <div class="grid gap-2 sm:grid-cols-2">
      <button
        v-for="option in options"
        :key="option.value"
        class="cursor-pointer rounded-lg border px-3 py-3 text-left transition-colors"
        :class="
          modelValue === option.value
            ? 'border-gray-900 bg-gray-950 text-white'
            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
        "
        type="button"
        @click="emit('update:modelValue', option.value)"
      >
        <span class="block text-sm font-semibold">
          {{ option.label }}
        </span>
        <span
          class="mt-1 block text-xs leading-relaxed"
          :class="modelValue === option.value ? 'text-gray-200' : 'text-gray-500'"
        >
          {{ option.description }}
        </span>
      </button>
    </div>

    <div class="border-t border-gray-200 pt-5">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 class="text-sm font-semibold text-gray-900">灵感词库</h4>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            每行一个词，空行和 # 开头的注释会被忽略。
          </p>
        </div>
        <span class="text-xs text-gray-400">
          当前 {{ activeTerms.length }} 条，编辑后 {{ parsedDraftTerms.length }} 条
        </span>
      </div>

      <div class="grid min-h-0 gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav class="space-y-1" aria-label="灵感词库分类">
          <button
            v-for="section in wordbankSections"
            :key="section.key"
            class="w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors"
            :class="
              activeSection === section.key
                ? 'border-gray-900 bg-gray-50 text-gray-900'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            "
            type="button"
            @click="activeSection = section.key"
          >
            <span class="block text-sm font-medium">{{ section.label }}</span>
            <span class="mt-1 block text-xs leading-relaxed text-gray-500">
              {{ section.description }}
            </span>
          </button>
        </nav>

        <div class="min-w-0 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-gray-800">
                {{ activeSectionMeta.label }}
              </div>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ activeSectionMeta.description }}
              </p>
            </div>
            <button
              class="cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              type="button"
              @click="restoreDefault"
            >
              恢复默认
            </button>
          </div>

          <textarea
            v-model="draftText"
            class="h-52 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-gray-900 outline-none transition-colors focus:border-gray-500"
            spellcheck="false"
          />

          <div class="flex flex-wrap items-center justify-between gap-3">
            <input
              v-model="searchText"
              class="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm outline-none transition-colors focus:border-gray-500"
              placeholder="搜索当前词库"
              type="search"
            >
            <button
              class="cursor-pointer rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!hasChanges"
              @click="saveDraft"
            >
              保存词库
            </button>
          </div>

          <div class="rounded-lg border border-gray-200">
            <div class="border-b border-gray-200 px-3 py-2 text-xs text-gray-500">
              匹配 {{ filteredTerms.length }} 条
            </div>
            <div class="max-h-40 overflow-y-auto p-2">
              <div
                v-if="!filteredTerms.length"
                class="px-2 py-5 text-center text-sm text-gray-400"
              >
                没有匹配的灵感词
              </div>
              <div v-else class="flex flex-wrap gap-1.5">
                <span
                  v-for="term in filteredTerms"
                  :key="term"
                  class="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600"
                >
                  {{ term }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
