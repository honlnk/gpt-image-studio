<script setup lang="ts">
import type { ConnectionMode, LanguageSetting } from "../../types/studio";
import { useSettingsStore } from "../../stores/settingsStore";
import { useFeedbackStore } from "../../stores/feedbackStore";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  autoRetryOnNetworkError: boolean;
  connectionMode: ConnectionMode;
}>();

const emit = defineEmits<{
  "update:autoRetryOnNetworkError": [value: boolean];
  "update:connectionMode": [value: ConnectionMode];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const feedback = useFeedbackStore();

function modeLabel(mode: ConnectionMode): string {
  return mode === "direct"
    ? t("settings.general.modeDirect")
    : t("settings.general.modeLocalCompanion");
}

const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguageSetting; labelKey: string }> = [
  { value: "auto", labelKey: "settings.general.languageAuto" },
  { value: "zh-CN", labelKey: "settings.general.languageZh" },
  { value: "en-US", labelKey: "settings.general.languageEn" },
];

/**
 * 切换连接模式前先弹确认框：
 * 1) 说明数据隔离语义（切回可找回），对标 Companion 管理页切换存储位置的确认；
 * 2) reload 不可撤销，避免用户误点后页面猝不及防刷新。
 * 嵌入态 / 桌面内置态禁用切换（连接由宿主 / sidecar 固定）。
 */
async function handleSwitchMode(mode: ConnectionMode) {
  if (settings.isEmbedded || settings.isDesktopCompanion) return;
  const current = props.connectionMode;
  if (mode === current) return;
  const confirmed = await feedback.requestConfirmation({
    title: t("settings.general.switchTitle", { target: modeLabel(mode) }),
    description: t("settings.general.switchDescription", {
      current: modeLabel(current),
    }),
    confirmLabel: t("settings.general.switchConfirm"),
  });
  if (!confirmed) return;
  emit("update:connectionMode", mode);
}
</script>

<template>
  <section aria-labelledby="generalSettingsTitle">
    <h3 id="generalSettingsTitle" class="text-base font-semibold text-gray-900">
      {{ $t("settings.general.title") }}
    </h3>

    <div class="mt-4 space-y-4">
      <!-- 嵌入态提示：连接配置由宿主注入，用户不可编辑 -->
      <div
        v-if="settings.isEmbedded"
        class="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-1"
      >
        <p class="text-sm font-medium text-blue-800">
          {{ $t("settings.general.embeddedTitle") }}
        </p>
        <p class="text-xs leading-relaxed text-blue-700">
          {{ $t("settings.general.embeddedDescription") }}
        </p>
      </div>

      <!-- 桌面内置态提示：sidecar 随应用启动，连接自动建立 -->
      <div
        v-if="settings.isDesktopCompanion"
        class="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1"
      >
        <p class="text-sm font-medium text-green-800">
          {{ $t("settings.general.desktopTitle") }}
        </p>
        <p class="text-xs leading-relaxed text-green-700">
          {{ $t("settings.general.desktopDescription") }}
        </p>
      </div>

      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">
          {{ $t("settings.general.connectionMode") }}
        </p>
        <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'direct' } }"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              connectionMode === 'direct'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
              settings.isEmbedded || settings.isDesktopCompanion ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]"
            type="button"
            :disabled="settings.isEmbedded || settings.isDesktopCompanion"
            @click="handleSwitchMode('direct')"
          >
            {{ $t("settings.general.modeDirect") }}
          </button>
          <button
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'localCompanion' } }"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              connectionMode === 'localCompanion'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
              settings.isEmbedded || settings.isDesktopCompanion ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]"
            type="button"
            :disabled="settings.isEmbedded || settings.isDesktopCompanion"
            @click="handleSwitchMode('localCompanion')"
          >
            {{ $t("settings.general.modeLocalCompanion") }}
          </button>
        </div>
        <p class="mt-1.5 text-xs leading-relaxed text-gray-500">
          {{ $t("settings.general.connectionModeHint") }}
        </p>
      </div>

      <!-- 界面语言：auto = 跟随系统 locale（zh* → 中文，其余 → 英文） -->
      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">
          {{ $t("settings.general.languageTitle") }}
        </p>
        <div class="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            v-for="option in LANGUAGE_OPTIONS"
            :key="option.value"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              settings.language === option.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
            ]"
            type="button"
            @click="settings.setLanguage(option.value)"
          >
            {{ $t(option.labelKey) }}
          </button>
        </div>
      </div>

      <div class="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-3 py-2.5">
        <div>
          <div class="text-sm font-medium text-gray-700">
            {{ $t("settings.general.autoRetryTitle") }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            {{ $t("settings.general.autoRetryDescription") }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="autoRetryOnNetworkError"
          :class="[
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            autoRetryOnNetworkError ? 'bg-gray-900' : 'bg-gray-300',
          ]"
          @click="emit('update:autoRetryOnNetworkError', !autoRetryOnNetworkError)"
        >
          <span
            :class="[
              'inline-block h-4 w-4 rounded-full bg-white transition-transform',
              autoRetryOnNetworkError ? 'translate-x-4' : 'translate-x-0.5',
            ]"
          />
        </button>
      </div>
    </div>
  </section>
</template>
