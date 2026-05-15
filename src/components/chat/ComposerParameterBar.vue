<script setup lang="ts">
import { useComposerStore } from "../../stores/composerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ComposerEditorPanel from "./ComposerEditorPanel.vue";

const emit = defineEmits<{
  "update:editModeEnabled": [value: boolean];
}>();

const composer = useComposerStore();
const settings = useSettingsStore();
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span
      class="cursor-not-allowed rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400"
    >
      模型: {{ settings.model }}
    </span>
    <button
      :class="[
        'cursor-pointer rounded-full px-2 py-0.5 text-[11px] transition-colors',
        composer.editModeEnabled
          ? 'bg-black text-white hover:bg-gray-800'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
      ]"
      type="button"
      @click="emit('update:editModeEnabled', !composer.editModeEnabled)"
    >
      区域编辑: {{ composer.editModeEnabled ? "开" : "关" }}
    </button>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'size' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('size')"
      >
        尺寸: {{ settings.sizeLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'size'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'quality' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('quality')"
      >
        质量: {{ settings.qualityLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'quality'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'background' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('background')"
      >
        背景: {{ settings.backgroundLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'background'"
        :active-editor="composer.activeEditor"
      />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="composer.activeEditor === 'format' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="composer.toggleEditor('format')"
      >
        格式: {{ settings.formatLabel }}
      </button>
      <ComposerEditorPanel
        v-if="composer.activeEditor === 'format'"
        :active-editor="composer.activeEditor"
      />
    </span>
  </div>
</template>
