<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  PromptMode,
  PromptWordbankSectionKey,
  PromptWordbanks,
} from "../../types/studio";

const { t } = useI18n();

const props = defineProps<{
  modelValue: PromptMode;
  wordbanks: PromptWordbanks;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: PromptMode];
  saveWordbank: [section: PromptWordbankSectionKey, terms: string[]];
  restoreDefaultWordbank: [section: PromptWordbankSectionKey];
}>();

const options = computed<
  Array<{
    value: PromptMode;
    label: string;
    description: string;
  }>
>(() => [
  {
    value: "default",
    label: t("settings.promptMode.modeDefault"),
    description: t("settings.promptMode.modeDefaultDescription"),
  },
  {
    value: "safe",
    label: t("settings.promptMode.modeSafe"),
    description: t("settings.promptMode.modeSafeDescription"),
  },
  {
    value: "creative",
    label: t("settings.promptMode.modeCreative"),
    description: t("settings.promptMode.modeCreativeDescription"),
  },
  {
    value: "adult",
    label: t("settings.promptMode.modeAdult"),
    description: t("settings.promptMode.modeAdultDescription"),
  },
]);

const wordbankSections = computed<
  Array<{
    key: PromptWordbankSectionKey;
    label: string;
    description: string;
  }>
>(() => [
  {
    key: "pose.safe",
    label: t("settings.promptMode.wordbankSafe"),
    description: t("settings.promptMode.wordbankSafeDescription"),
  },
  {
    key: "pose.creative",
    label: t("settings.promptMode.wordbankCreative"),
    description: t("settings.promptMode.wordbankCreativeDescription"),
  },
  {
    key: "pose.nsfw",
    label: t("settings.promptMode.wordbankOpen"),
    description: t("settings.promptMode.wordbankOpenDescription"),
  },
  {
    key: "adultInspiration",
    label: t("settings.promptMode.wordbankInspiration"),
    description: t("settings.promptMode.wordbankInspirationDescription"),
  },
]);

const activeSection = ref<PromptWordbankSectionKey>("pose.safe");
const draftText = ref("");
const searchText = ref("");

const activeSectionMeta = computed(
  () =>
    wordbankSections.value.find(
      (section) => section.key === activeSection.value,
    ) ?? wordbankSections.value[0],
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
        {{ $t("settings.promptMode.title") }}
      </h3>
      <p class="mt-1 text-sm leading-relaxed text-gray-500">
        {{ $t("settings.promptMode.description") }}
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
          <h4 class="text-sm font-semibold text-gray-900">
            {{ $t("settings.promptMode.wordbankTitle") }}
          </h4>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            {{ $t("settings.promptMode.wordbankHint") }}
          </p>
        </div>
        <span class="text-xs text-gray-400">
          {{
            $t("settings.promptMode.termCount", {
              current: activeTerms.length,
              draft: parsedDraftTerms.length,
            })
          }}
        </span>
      </div>

      <div class="grid min-h-0 gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          class="space-y-1"
          :aria-label="$t('settings.promptMode.wordbankNavAria')"
        >
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
              {{ $t("settings.promptMode.restoreDefault") }}
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
              :placeholder="$t('settings.promptMode.searchPlaceholder')"
              type="search"
            >
            <button
              class="cursor-pointer rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!hasChanges"
              @click="saveDraft"
            >
              {{ $t("settings.promptMode.saveWordbank") }}
            </button>
          </div>

          <div class="rounded-lg border border-gray-200">
            <div class="border-b border-gray-200 px-3 py-2 text-xs text-gray-500">
              {{
                $t("settings.promptMode.matchedCount", {
                  count: filteredTerms.length,
                })
              }}
            </div>
            <div class="max-h-40 overflow-y-auto p-2">
              <div
                v-if="!filteredTerms.length"
                class="px-2 py-5 text-center text-sm text-gray-400"
              >
                {{ $t("settings.promptMode.noMatchedTerms") }}
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
