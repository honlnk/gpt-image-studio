<script setup lang="ts">
import { ref } from "vue";
import type { AnalyticsPromptCapture } from "../../types/studio";
import ConfirmDialog from "../ui/ConfirmDialog.vue";

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

const promptCaptureOptions: { value: AnalyticsPromptCapture; label: string; hint: string }[] = [
  { value: "none", label: "不记录", hint: "完全不记录提示词" },
  { value: "length_only", label: "仅长度", hint: "只记录字符数" },
  { value: "masked", label: "脱敏", hint: "保留首尾并遮蔽中间" },
  { value: "raw", label: "原文", hint: "完整保留提示词" },
];

function requestClear() {
  clearDialog.value = {
    title: "清空行为日志",
    description: "将删除本设备已记录的全部行为日志，此操作不可撤销。",
    confirmLabel: "清空",
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
      行为日志
    </h3>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">
      记录本设备上的关键操作轨迹，用于后续可用性分析。所有数据仅保存在本地浏览器，不会上传。行为日志不包含在备份导出中。
    </p>

    <div class="mt-5 space-y-5">
      <label class="flex items-center gap-2 text-sm text-gray-700">
        <input
          class="h-4 w-4 cursor-pointer rounded border-gray-300 text-black focus:ring-black"
          type="checkbox"
          :checked="enabled"
          @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
        />
        启用行为日志采集
      </label>

      <div>
        <span class="mb-2 block text-sm font-medium text-gray-700">提示词采集级别</span>
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
        已记录事件：<span class="font-semibold text-gray-900">{{ eventCount }}</span> 条
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          type="button"
          @click="emit('exportEvents')"
        >
          导出日志
        </button>
        <button
          class="cursor-pointer rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          type="button"
          @click="requestClear"
        >
          清空日志
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
