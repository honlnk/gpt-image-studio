<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ApiMode } from "../../types/studio";
import { FIXED_IMAGE_MODEL } from "../../shared/models";
import DropdownSelect from "../ui/DropdownSelect.vue";
import { copyText as copyTextToClipboard } from "../../shared/clipboard";

/**
 * 接口设置面板（仅浏览器直连模式显示）。
 *
 * Companion 模式下本 tab 不显示——Companion 的 provider 凭据由管理页维护，
 * 连接信息在「Companion」tab（CompanionInfoPanel）。
 */

const props = defineProps<{
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiMode: ApiMode;
  apiKey: string;
  model: string;
  modelOptions: ReadonlyArray<{ value: string; label: string }>;
  modelsProbe: {
    status: "idle" | "loading" | "ok" | "error";
    modelIds: string[];
    message: string;
  };
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
}>();

const emit = defineEmits<{
  "update:apiBaseUrl": [value: string];
  "update:apiBaseUrlMode": [value: "origin" | "full"];
  "update:apiMode": [value: ApiMode];
  "update:apiKey": [value: string];
  "update:model": [value: string];
  probeModels: [];
  "update:streamImages": [value: boolean];
  "update:streamPartialImages": [value: 0 | 1 | 2 | 3];
}>();

const { t } = useI18n();

const apiKeyVisible = ref(false);
const apiKeyCopyStatus = ref<"idle" | "copied" | "failed">("idle");
let apiKeyCopyStatusTimer: ReturnType<typeof setTimeout> | undefined;

// Images API / Responses API 为专有名词，label 保持原文；描述文案走 i18n。
const apiModeOptions = computed<
  Array<{ value: ApiMode; label: string; description: string }>
>(() => [
  {
    value: "images",
    label: "Images API",
    description: t("settings.api.modeImagesDescription"),
  },
  {
    value: "responses",
    label: "Responses API",
    description: t("settings.api.modeResponsesDescription"),
  },
]);
const partialImageOptions = [0, 1, 2, 3] as const;
// DropdownSelect 以字符串值工作，这里把数值选项拍平成 {value,label}。
const partialImageSelectOptions = partialImageOptions.map((count) => ({
  value: String(count),
  label: String(count),
}));
const apiBaseUrlHint = computed(() =>
  props.apiBaseUrlMode === "full"
    ? props.apiMode === "responses"
      ? "https://api.example.com/v1"
      : "https://api.example.com/v1/images"
    : "https://api.example.com",
);
const apiSuffixLabel = computed(() =>
  props.apiMode === "responses" ? "/v1" : "/v1/images",
);
const probeBusy = computed(() => props.modelsProbe.status === "loading");
/** 2.5 两档中实际匹配到的数量（探测成功时用于提示）。 */
const matchedNewModelCount = computed(() =>
  props.modelsProbe.status === "ok"
    ? props.modelOptions.filter((o) => o.value !== FIXED_IMAGE_MODEL).length
    : 0,
);

function normalizeApiBaseUrlInput(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function resetApiKeyCopyStatusSoon() {
  if (apiKeyCopyStatusTimer) {
    clearTimeout(apiKeyCopyStatusTimer);
  }
  apiKeyCopyStatusTimer = setTimeout(() => {
    apiKeyCopyStatus.value = "idle";
  }, 1600);
}

function toggleApiKeyVisibility() {
  apiKeyVisible.value = !apiKeyVisible.value;
  apiKeyCopyStatus.value = "idle";
}

async function copyApiKey() {
  if (!apiKeyVisible.value || !props.apiKey) return;

  try {
    await copyTextToClipboard(props.apiKey);
    apiKeyCopyStatus.value = "copied";
  } catch {
    apiKeyCopyStatus.value = "failed";
  }

  resetApiKeyCopyStatusSoon();
}

onUnmounted(() => {
  if (apiKeyCopyStatusTimer) {
    clearTimeout(apiKeyCopyStatusTimer);
  }
});
</script>

<template>
  <section aria-labelledby="apiSettingsTitle">
    <h3 id="apiSettingsTitle" class="text-base font-semibold text-gray-900">
      {{ $t("settings.api.title") }}
    </h3>
    <p class="mt-1 text-sm text-gray-500">
      {{ $t("settings.api.description") }}
    </p>

    <div class="mt-5 space-y-4">
      <div class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        {{ $t("settings.api.securityNotice") }}
      </div>

      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">
          {{ $t("settings.api.modeLabel") }}
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="option in apiModeOptions"
            :key="option.value"
            class="cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors"
            :class="
              apiMode === option.value
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            "
            type="button"
            @click="emit('update:apiMode', option.value)"
          >
            <div class="text-sm font-semibold">{{ option.label }}</div>
            <div
              class="mt-1 text-xs"
              :class="apiMode === option.value ? 'text-gray-200' : 'text-gray-500'"
            >
              {{ option.description }}
            </div>
          </button>
        </div>
      </div>

      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700"
          for="apiKey"
        >
          {{ $t("settings.api.apiKeyLabel") }}
        </label>
        <div class="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-500">
          <input
            id="apiKey"
            :value="apiKey"
            class="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-gray-900 outline-none"
            autocomplete="off"
            placeholder="sk-..."
            :type="apiKeyVisible ? 'text' : 'password'"
            @input="
              emit('update:apiKey', ($event.target as HTMLInputElement).value)
            "
          />
          <button
            class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            type="button"
            :aria-label="
              apiKeyVisible
                ? $t('settings.api.hideApiKey')
                : $t('settings.api.showApiKey')
            "
            :title="
              apiKeyVisible
                ? $t('settings.api.hideApiKey')
                : $t('settings.api.showApiKey')
            "
            @click="toggleApiKeyVisibility"
          >
            <svg
              v-if="apiKeyVisible"
              aria-hidden="true"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg
              v-else
              aria-hidden="true"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="m3 3 18 18" />
              <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
              <path d="M9.88 4.24A10.38 10.38 0 0 1 12 4c7 0 10 8 10 8a15.51 15.51 0 0 1-2.45 3.67" />
              <path d="M6.61 6.61A15.8 15.8 0 0 0 2 12s3 8 10 8a10.4 10.4 0 0 0 5.39-1.61" />
            </svg>
          </button>
          <button
            v-if="apiKeyVisible"
            class="flex h-10 shrink-0 cursor-pointer items-center border-l border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
            type="button"
            :disabled="!apiKey"
            :aria-label="
              apiKeyCopyStatus === 'copied'
                ? $t('settings.api.apiKeyCopied')
                : $t('settings.api.copyApiKey')
            "
            :title="
              apiKeyCopyStatus === 'copied'
                ? $t('settings.api.copied')
                : $t('settings.api.copyApiKey')
            "
            @click="copyApiKey"
          >
            {{ apiKeyCopyStatus === "copied" ? $t("settings.api.copied") : $t("common.copy") }}
          </button>
          <button
            class="flex h-10 shrink-0 cursor-pointer items-center border-l border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
            type="button"
            :disabled="!apiKey || probeBusy"
            :title="$t('settings.api.testTooltip')"
            @click="emit('probeModels')"
          >
            {{ probeBusy ? $t("settings.api.testing") : $t("settings.api.test") }}
          </button>
        </div>
        <p
          v-if="probeBusy || modelsProbe.status === 'ok' || modelsProbe.status === 'error'"
          class="mt-1.5 text-xs"
          :class="
            modelsProbe.status === 'ok'
              ? 'text-emerald-600'
              : modelsProbe.status === 'error'
                ? 'text-red-500'
                : 'text-gray-500'
          "
        >
          <template v-if="probeBusy">{{
            $t("settings.api.probeChecking")
          }}</template>
          <template v-else-if="modelsProbe.status === 'ok'">
            {{
              $t("settings.api.probeOk", {
                count: modelsProbe.modelIds.length,
              })
            }}
          </template>
          <template v-else>{{ modelsProbe.message }}</template>
        </p>
        <p
          v-if="apiKeyCopyStatus === 'failed'"
          class="mt-1.5 text-xs text-red-500"
        >
          {{ $t("settings.api.copyFailed") }}
        </p>
      </div>

      <div>
        <div class="mb-1 flex items-center justify-between gap-3">
          <label
            class="block text-sm font-medium text-gray-700"
            for="apiBaseUrl"
          >
            {{ $t("settings.api.baseUrlLabel") }}
          </label>
          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input
              class="h-3.5 w-3.5 cursor-pointer accent-gray-900"
              type="checkbox"
              :checked="apiBaseUrlMode === 'full'"
              @change="
                emit(
                  'update:apiBaseUrlMode',
                  ($event.target as HTMLInputElement).checked ? 'full' : 'origin',
                )
              "
            />
            {{ $t("settings.api.fullBaseUrlLabel") }}
          </label>
        </div>
        <div class="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-500">
          <input
            id="apiBaseUrl"
            :value="apiBaseUrl"
            class="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-gray-900 outline-none"
            :placeholder="apiBaseUrlHint"
            type="url"
            @input="
              emit(
                'update:apiBaseUrl',
                ($event.target as HTMLInputElement).value,
              )
            "
            @blur="
              emit(
                'update:apiBaseUrl',
                normalizeApiBaseUrlInput(($event.target as HTMLInputElement).value),
              )
            "
          />
          <span
            v-if="apiBaseUrlMode === 'origin'"
            class="flex shrink-0 items-center border-l border-gray-200 px-3 text-sm font-medium text-red-500"
          >
            {{ apiSuffixLabel }}
          </span>
        </div>
        <p class="mt-1.5 text-xs text-gray-500">
          <template v-if="apiBaseUrlMode === 'origin'">
            {{
              $t("settings.api.baseUrlOriginHint", { suffix: apiSuffixLabel })
            }}
          </template>
          <template v-else>
            {{ $t("settings.api.baseUrlFullHint") }}
          </template>
        </p>
      </div>

      <div>
        <label
          class="mb-1 block text-sm font-medium text-gray-700"
          for="apiModel"
        >
          {{ $t("settings.api.modelLabel") }}
        </label>
        <DropdownSelect
          id="apiModel"
          :options="modelOptions"
          :model-value="
            modelOptions.some((o) => o.value === model)
              ? model
              : FIXED_IMAGE_MODEL
          "
          @update:model-value="emit('update:model', $event)"
        />
        <p class="mt-1.5 text-xs text-gray-500">
          <template v-if="probeBusy">{{
            $t("settings.api.modelListLoading")
          }}</template>
          <template v-else-if="modelsProbe.status === 'ok' && matchedNewModelCount === 0">
            {{ $t("settings.api.modelListNoNew") }}
          </template>
          <template v-else-if="modelsProbe.status === 'ok'">
            {{ $t("settings.api.modelListFiltered") }}
          </template>
          <template v-else-if="modelsProbe.status === 'error'">
            {{
              $t("settings.api.modelListError", {
                message: modelsProbe.message,
              })
            }}
          </template>
          <template v-else>
            {{ $t("settings.api.modelHint25Before") }}
            <span class="font-mono">gpt-image-2</span>{{ $t("settings.api.modelHint25After") }}
          </template>
          <button
            class="ml-1 cursor-pointer text-gray-700 underline underline-offset-2 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
            type="button"
            :disabled="probeBusy"
            @click="emit('probeModels')"
          >
            {{
              modelsProbe.status === "idle"
                ? $t("settings.api.checkAvailability")
                : $t("settings.api.recheck")
            }}
          </button>
        </p>
      </div>

      <div class="rounded-xl border border-gray-200 p-4">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            class="mt-0.5 h-4 w-4 cursor-pointer accent-gray-900"
            type="checkbox"
            :checked="streamImages"
            @change="
              emit(
                'update:streamImages',
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <span class="min-w-0">
            <span class="block text-sm font-medium text-gray-700">{{
              $t("settings.api.streamPreviewTitle")
            }}</span>
            <span class="mt-1 block text-xs text-gray-500">
              {{ $t("settings.api.streamPreviewDescription") }}
            </span>
          </span>
        </label>

        <div class="mt-4">
          <label
            class="mb-1 block text-sm font-medium text-gray-700"
            for="streamPartialImages"
          >
            {{ $t("settings.api.partialImagesLabel") }}
          </label>
          <DropdownSelect
            id="streamPartialImages"
            :disabled="!streamImages"
            :model-value="String(streamPartialImages)"
            :options="partialImageSelectOptions"
            @update:model-value="
              emit('update:streamPartialImages', Number($event) as 0 | 1 | 2 | 3)
            "
          />
          <p class="mt-1.5 text-xs text-gray-500">
            {{ $t("settings.api.partialImagesHint") }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
