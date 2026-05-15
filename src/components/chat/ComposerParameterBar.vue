<script setup lang="ts">
import type { EditorKey } from "../../types/studio";

defineProps<{
  activeEditor: EditorKey | null;
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
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span
      class="cursor-not-allowed rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400"
    >
      模型: {{ model }}
    </span>
    <button
      :class="[
        'cursor-pointer rounded-full px-2 py-0.5 text-[11px] transition-colors',
        editModeEnabled
          ? 'bg-black text-white hover:bg-gray-800'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
      ]"
      type="button"
      @click="emit('update:editModeEnabled', !editModeEnabled)"
    >
      区域编辑: {{ editModeEnabled ? "开" : "关" }}
    </button>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="activeEditor === 'size' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="emit('toggleEditor', 'size')"
      >
        尺寸: {{ sizeLabel }}
      </button>
      <slot v-if="activeEditor === 'size'" name="size-editor" />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="activeEditor === 'quality' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="emit('toggleEditor', 'quality')"
      >
        质量: {{ qualityLabel }}
      </button>
      <slot v-if="activeEditor === 'quality'" name="quality-editor" />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="activeEditor === 'background' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="emit('toggleEditor', 'background')"
      >
        背景: {{ backgroundLabel }}
      </button>
      <slot v-if="activeEditor === 'background'" name="background-editor" />
    </span>
    <span class="relative inline-flex">
      <button
        class="cursor-pointer rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200"
        :class="activeEditor === 'format' ? 'bg-gray-200 text-gray-800' : ''"
        type="button"
        @click="emit('toggleEditor', 'format')"
      >
        格式: {{ formatLabel }}
      </button>
      <slot v-if="activeEditor === 'format'" name="format-editor" />
    </span>
  </div>
</template>
