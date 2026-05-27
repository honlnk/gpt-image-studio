<script setup lang="ts">
import type { PromptMode } from "../../types/studio";

defineProps<{
  modelValue: PromptMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: PromptMode];
}>();

const options: Array<{
  value: PromptMode;
  label: string;
  description: string;
}> = [
  {
    value: "default",
    label: "默认",
    description: "不追加任何模式指令，保持当前逻辑。",
  },
  {
    value: "safe",
    label: "安全",
    description: "使用安全提示词方向，只抽取 safe 词库。",
  },
  {
    value: "creative",
    label: "创意",
    description: "使用 safe + creative 词库，强化性感氛围和画面张力。",
  },
  {
    value: "adult",
    label: "开放",
    description: "使用 safe + creative + nsfw 词库，适合支持成人内容的模型或接口。",
  },
];
</script>

<template>
  <section aria-labelledby="promptModeSettingsTitle">
    <h3 id="promptModeSettingsTitle" class="text-base font-semibold text-gray-900">
      提示词模式
    </h3>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      当前设置只影响发送给图片接口的请求文本，不会改写聊天记录里的原始提示词。
    </p>

    <div class="mt-4 grid gap-2 sm:grid-cols-2">
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
  </section>
</template>
