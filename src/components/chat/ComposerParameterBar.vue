<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useComposerStore } from "../../stores/composerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ComposerEditorPanel from "./ComposerEditorPanel.vue";

const emit = defineEmits<{
  "update:editModeEnabled": [value: boolean];
}>();

const { t } = useI18n();
const composer = useComposerStore();
const settings = useSettingsStore();
const promptModeLabel = computed(() => {
  const labels = {
    default: t("chat.parameterBar.promptModeDefault"),
    safe: t("chat.parameterBar.promptModeSafe"),
    creative: t("chat.parameterBar.promptModeCreative"),
    adult: t("chat.parameterBar.promptModeOpen"),
  };
  return labels[settings.promptMode];
});

watch(
  () => [settings.backgroundTagVisible, settings.formatTagVisible] as const,
  ([backgroundVisible, formatVisible]) => {
    if (
      (!backgroundVisible && composer.activeEditor === "background") ||
      (!formatVisible && composer.activeEditor === "format")
    ) {
      composer.closeAllEditors();
    }
  },
);
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span
      class="cursor-not-allowed rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400"
    >
      {{ $t("chat.parameterBar.model") }}: {{ settings.model }}
    </span>
    <span
      class="cursor-not-allowed rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400"
    >
      {{ $t("chat.parameterBar.content") }}: {{ promptModeLabel }}
    </span>
    <button
      v-if="settings.providerCapability.mask"
      :class="[
        'cursor-pointer rounded-full px-2 py-0.5 text-[11px] transition-colors',
        composer.editModeEnabled
          ? 'bg-black text-white hover:bg-gray-800'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
      ]"
      type="button"
      v-track="{ name: 'generation.edit_mode_toggled', payload: { enabled: !composer.editModeEnabled } }"
      @click="emit('update:editModeEnabled', !composer.editModeEnabled)"
    >
      {{ $t("chat.parameterBar.editMode") }}:
      {{ composer.editModeEnabled ? $t("chat.parameterBar.on") : $t("chat.parameterBar.off") }}
    </button>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'size' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('size')"
      >
        {{ $t("chat.parameterBar.size") }}: {{ settings.sizeLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'size'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'count' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('count')"
      >
        {{ $t("chat.parameterBar.count") }}: {{ settings.imageCount }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'count'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span v-if="settings.backgroundTagVisible" class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'background' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('background')"
      >
        {{ $t("chat.parameterBar.background") }}: {{ settings.backgroundLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'background'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span v-if="settings.formatTagVisible" class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'format' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('format')"
      >
        {{ $t("chat.parameterBar.format") }}: {{ settings.formatLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'format'"
        :active-editor="composer.activeEditor"
      />
    </span>
  </div>
</template>
