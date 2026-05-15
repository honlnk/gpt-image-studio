<script setup lang="ts">
import type { EditorKey, GenerationParams } from "../../types/studio";

defineProps<{
  activeEditor: EditorKey | null;
  activeSizePreset: string;
  background: string;
  backgroundOptions: readonly { value: string; label: string }[];
  customSizeError: string;
  imageHeight: number;
  imageWidth: number;
  isEditorExpanded: boolean;
  outputFormat: string;
  formatOptions: readonly { value: string; label: string }[];
  quality: string;
  qualityOptions: readonly { value: string; label: string }[];
  sizePresets: readonly GenerationParams["size"][];
}>();

const emit = defineEmits<{
  applySizePreset: [preset: GenerationParams["size"]];
  "update:background": [value: string];
  "update:imageHeight": [value: number];
  "update:imageWidth": [value: number];
  "update:outputFormat": [value: string];
  "update:quality": [value: string];
}>();
</script>

<template>
  <div
    :class="[
      'editor-collapse mb-2',
      isEditorExpanded ? 'editor-collapse--open' : '',
    ]"
    @click.stop
  >
    <div class="editor-collapse__inner">
      <div
        v-if="activeEditor === 'size'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <button
          v-for="preset in sizePresets"
          :key="preset"
          :class="[
            'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
            activeSizePreset === preset
              ? 'border-gray-400 bg-gray-100 text-gray-900'
              : 'border-gray-200 text-gray-400 hover:bg-gray-50',
          ]"
          type="button"
          @click="emit('applySizePreset', preset)"
        >
          {{
            preset === "custom"
              ? "自定义"
              : preset === "auto"
                ? "自动"
                : preset
          }}
        </button>
        <div
          v-if="activeSizePreset === 'custom'"
          class="flex items-center gap-2"
        >
          <input
            :value="imageWidth"
            class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
            type="number"
            min="16"
            max="3840"
            step="16"
            placeholder="宽"
            @input="
              emit(
                'update:imageWidth',
                Number(($event.target as HTMLInputElement).value),
              )
            "
          />
          <span class="text-xs text-gray-400">×</span>
          <input
            :value="imageHeight"
            class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
            type="number"
            min="16"
            max="3840"
            step="16"
            placeholder="高"
            @input="
              emit(
                'update:imageHeight',
                Number(($event.target as HTMLInputElement).value),
              )
            "
          />
        </div>
        <p
          v-if="customSizeError"
          class="basis-full pt-1 text-xs text-red-500"
        >
          {{ customSizeError }}
        </p>
      </div>

      <div
        v-if="activeEditor === 'quality'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <button
          v-for="opt in qualityOptions"
          :key="opt.value"
          :class="[
            'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
            quality === opt.value
              ? 'border-gray-400 bg-gray-100 text-gray-900'
              : 'border-gray-200 text-gray-400 hover:bg-gray-50',
          ]"
          type="button"
          @click="emit('update:quality', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div
        v-if="activeEditor === 'background'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <button
          v-for="opt in backgroundOptions"
          :key="opt.value"
          :class="[
            'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
            background === opt.value
              ? 'border-gray-400 bg-gray-100 text-gray-900'
              : 'border-gray-200 text-gray-400 hover:bg-gray-50',
          ]"
          type="button"
          @click="emit('update:background', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div
        v-if="activeEditor === 'format'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <button
          v-for="opt in formatOptions"
          :key="opt.value"
          :class="[
            'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
            outputFormat === opt.value
              ? 'border-gray-400 bg-gray-100 text-gray-900'
              : 'border-gray-200 text-gray-400 hover:bg-gray-50',
          ]"
          type="button"
          @click="emit('update:outputFormat', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease-out;
}

.editor-collapse--open {
  grid-template-rows: 1fr;
}

.editor-collapse__inner {
  overflow: hidden;
}
</style>
