<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AnalyticsPromptCapture } from "../../types/studio";
import ConfirmDialog from "../ui/ConfirmDialog.vue";

const { t } = useI18n();

type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default";
};

defineProps<{
  enabled: boolean;
  promptCapture: AnalyticsPromptCapture;
  eventCount: number;
}>();

const emit = defineEmits<{
  "update:enabled": [value: boolean];
  "update:promptCapture": [value: AnalyticsPromptCapture];
  exportEvents: [];
  clearEvents: [];
}>();

const clearDialog = ref<ConfirmDialogState | null>(null);

const promptCaptureOptions = computed<
  { value: AnalyticsPromptCapture; label: string; hint: string }[]
>(() => [
  {
    value: "none",
    label: t("settings.analytics.captureNoneLabel"),
    hint: t("settings.analytics.captureNoneHint"),
  },
  {
    value: "length_only",
    label: t("settings.analytics.captureLengthLabel"),
    hint: t("settings.analytics.captureLengthHint"),
  },
  {
    value: "masked",
    label: t("settings.analytics.captureMaskedLabel"),
    hint: t("settings.analytics.captureMaskedHint"),
  },
  {
    value: "raw",
    label: t("settings.analytics.captureRawLabel"),
    hint: t("settings.analytics.captureRawHint"),
  },
]);

function requestClear() {
  clearDialog.value = {
    title: t("settings.analytics.clearDialogTitle"),
    description: t("settings.analytics.clearDialogDescription"),
    confirmLabel: t("settings.analytics.clearDialogConfirm"),
    tone: "danger",
  };
}

function confirmClear() {
  emit("clearEvents");
  clearDialog.value = null;
}
</script>

<template>
  <section aria-labelledby="analyticsSettingsTitle">
    <h3
      id="analyticsSettingsTitle"
      class="text-base font-semibold text-gray-900"
    >
      {{ $t("settings.analytics.title") }}
    </h3>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      {{ $t("settings.analytics.description") }}
    </p>

    <div class="mt-5 space-y-5">
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input
          class="h-4 w-4 cursor-pointer rounded border-gray-300 text-black focus:ring-black"
          type="checkbox"
          :checked="enabled"
          @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ $t("settings.analytics.enableLabel") }}
      </label>

      <div>
        <span class="mb-2 block text-sm font-medium text-gray-700">{{ $t("settings.analytics.promptCaptureTitle") }}</span>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="option in promptCaptureOptions"
            :key="option.value"
            class="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors"
            :class="
              promptCapture === option.value
                ? 'border-black bg-black/[0.03]'
                : 'border-gray-200 hover:bg-gray-50'
            "
          >
            <input
              class="mt-0.5 h-4 w-4 cursor-pointer text-black focus:ring-black"
              type="radio"
              name="promptCapture"
              :value="option.value"
              :checked="promptCapture === option.value"
              @change="emit('update:promptCapture', option.value)"
            />
            <span>
              <span class="block font-medium text-gray-900">{{ option.label }}</span>
              <span class="block text-xs text-gray-500">{{ option.hint }}</span>
            </span>
          </label>
        </div>
      </div>

      <div class="rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
        {{ $t("settings.analytics.eventCountLabel") }}<span class="font-semibold text-gray-900">{{ eventCount }}</span>{{ $t("settings.analytics.eventCountUnit") }}
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          type="button"
          @click="emit('exportEvents')"
        >
          {{ $t("settings.analytics.exportButton") }}
        </button>
        <button
          class="cursor-pointer rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          type="button"
          @click="requestClear"
        >
          {{ $t("settings.analytics.clearButton") }}
        </button>
      </div>
    </div>

    <ConfirmDialog
      :dialog="clearDialog"
      @cancel="clearDialog = null"
      @confirm="confirmClear"
    />
  </section>
</template>
