<script setup lang="ts">
import type { EditorKey } from "../../types/studio";

defineProps<{
  backgroundLabel: string;
  editModeEnabled: boolean;
  formatLabel: string;
  model: string;
  qualityLabel: string;
  sizeLabel: string;
}>();

const emit = defineEmits<{
  toggleEditor: [key: EditorKey];
  "update:editModeEnabled": [value: boolean];
}>();
</script>

<template>
  <div class="mb-2 flex flex-wrap items-center gap-1.5" @click.stop>
    <span
      class="cursor-not-allowed rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400"
    >
      模型: {{ model }}
    </span>
    <button
      :class="[
        'cursor-pointer rounded-full px-2.5 py-0.5 text-xs transition-colors',
        editModeEnabled
          ? 'bg-black text-white hover:bg-gray-800'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
      ]"
      type="button"
      @click="emit('update:editModeEnabled', !editModeEnabled)"
    >
      区域编辑: {{ editModeEnabled ? "开" : "关" }}
    </button>
    <button
      class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
      type="button"
      @click="emit('toggleEditor', 'size')"
    >
      尺寸: {{ sizeLabel }}
    </button>
    <button
      class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
      type="button"
      @click="emit('toggleEditor', 'quality')"
    >
      质量: {{ qualityLabel }}
    </button>
    <button
      class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
      type="button"
      @click="emit('toggleEditor', 'background')"
    >
      背景: {{ backgroundLabel }}
    </button>
    <button
      class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
      type="button"
      @click="emit('toggleEditor', 'format')"
    >
      格式: {{ formatLabel }}
    </button>
  </div>
</template>
