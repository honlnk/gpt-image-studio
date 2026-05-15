<script setup lang="ts">
import { computed } from "vue";
import type {
  EditorKey,
  GenerationParams,
  SizeRatio,
  SizeResolution,
} from "../../types/studio";

type SizeRatioOption = {
  value: SizeRatio;
  label: string;
  widthRatio: number;
  heightRatio: number;
};

const props = defineProps<{
  activeEditor: EditorKey | null;
  activeSizePreset: GenerationParams["size"];
  background: string;
  backgroundOptions: readonly { value: string; label: string }[];
  customSizeError: string;
  imageHeight: number;
  imageWidth: number;
  outputFormat: string;
  formatOptions: readonly { value: string; label: string }[];
  quality: string;
  qualityOptions: readonly { value: string; label: string }[];
  sizeRatioOptions: readonly SizeRatioOption[];
  sizeResolution: SizeResolution;
  sizeResolutionOptions: readonly { value: SizeResolution; label: string }[];
}>();

const emit = defineEmits<{
  applySizePreset: [preset: GenerationParams["size"]];
  applySizeResolution: [resolution: SizeResolution];
  "update:background": [value: string];
  "update:imageHeight": [value: number];
  "update:imageWidth": [value: number];
  "update:outputFormat": [value: string];
  "update:quality": [value: string];
}>();

const isRatioMode = computed(() =>
  props.sizeRatioOptions.some((option) => option.value === props.activeSizePreset),
);

function selectSizePreset(preset: GenerationParams["size"]) {
  emit("applySizePreset", preset);
}

function selectRatioMode() {
  if (isRatioMode.value) return;
  emit("applySizePreset", "1:1");
}

function selectSizeResolution(resolution: SizeResolution) {
  emit("applySizeResolution", resolution);
}

function selectBackground(value: string) {
  emit("update:background", value);
}

function selectOutputFormat(value: string) {
  emit("update:outputFormat", value);
}

function selectQuality(value: string) {
  emit("update:quality", value);
}
</script>

<template>
  <div
    v-if="activeEditor"
    class="absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
    @click.stop
  >
      <div v-if="activeEditor === 'size'" class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <button
              :class="[
                'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                activeSizePreset === 'auto'
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50',
              ]"
              type="button"
              @click="selectSizePreset('auto')"
            >
              自动
            </button>
            <button
              :class="[
                'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                isRatioMode
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50',
              ]"
              type="button"
              @click="selectRatioMode"
            >
              比例
            </button>
            <button
              :class="[
                'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                activeSizePreset === 'custom'
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50',
              ]"
              type="button"
              @click="selectSizePreset('custom')"
            >
              自定义
            </button>
          </div>
          <div v-if="isRatioMode" class="flex items-center gap-1">
            <button
              v-for="resolution in sizeResolutionOptions"
              :key="resolution.value"
              :class="[
                'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                sizeResolution === resolution.value
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50',
              ]"
              type="button"
              @click="selectSizeResolution(resolution.value)"
            >
              {{ resolution.label }}
            </button>
          </div>
        </div>

        <div v-if="isRatioMode" class="grid w-64 grid-cols-4 gap-1.5">
          <button
            v-for="ratio in sizeRatioOptions"
            :key="ratio.value"
            :class="[
              'cursor-pointer rounded border px-1.5 py-1 text-xs transition-colors',
              activeSizePreset === ratio.value
                ? 'border-gray-400 bg-gray-100 text-gray-900'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            ]"
            type="button"
            @click="selectSizePreset(ratio.value)"
          >
            {{ ratio.label }}
          </button>
        </div>

        <div v-if="activeSizePreset === 'custom'" class="flex items-center gap-2">
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
        <p v-if="customSizeError" class="basis-full pt-1 text-xs text-red-500">
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
          @click="selectQuality(opt.value)"
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
          @click="selectBackground(opt.value)"
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
          @click="selectOutputFormat(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
</template>
