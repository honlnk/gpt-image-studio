<script setup lang="ts">
import { computed, ref } from "vue";
import type { StorageUsage } from "../../services/storageUsage";
import Tooltip from "../ui/Tooltip.vue";

const props = defineProps<{
  storageUsage: StorageUsage;
}>();

const storageExpanded = ref(false);

const storageTotalBytes = computed(
  () => props.storageUsage.quotaBytes || props.storageUsage.projectBytes || 0,
);
const storageUsedPercent = computed(() => {
  if (!props.storageUsage.quotaBytes) return 0;

  return percentOf(
    props.storageUsage.projectBytes,
    props.storageUsage.quotaBytes,
  );
});
const imageStoragePercent = computed(() =>
  percentOf(props.storageUsage.imageBytes, storageTotalBytes.value),
);
const metadataStoragePercent = computed(() =>
  percentOf(props.storageUsage.metadataBytes, storageTotalBytes.value),
);

function formatBytes(bytes?: number) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function percentOf(value: number, total: number) {
  if (!total) return 0;

  return Math.min(100, Math.max(0, (value / total) * 100));
}
</script>

<template>
  <div class="mt-3 rounded-lg border border-gray-200 bg-gray-50">
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      @click="storageExpanded = !storageExpanded"
    >
      <svg
        class="h-3 w-3 shrink-0 text-gray-400 transition-transform"
        :class="{ 'rotate-90': storageExpanded }"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fill-rule="evenodd"
          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
          clip-rule="evenodd"
        />
      </svg>
      <span class="font-medium text-gray-700">本地存储</span>
      <span class="ml-auto inline-flex items-center gap-1 text-gray-500">
        {{ formatBytes(storageUsage.projectBytes) }}
        <template v-if="storageUsage.quotaBytes">
          / {{ formatBytes(storageUsage.quotaBytes) }}
        </template>
      </span>
      <Tooltip text="根据当前浏览器和设备状态估算，可用空间可能会变化。">
        <span
          class="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-500 transition-colors hover:bg-gray-300"
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </span>
      </Tooltip>
    </button>
    <div v-show="storageExpanded" class="px-3 pb-3 pt-0">
      <div class="flex h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          class="h-full flex-none bg-gray-900"
          :style="{ width: `${imageStoragePercent}%` }"
          title="图片数据"
        ></div>
        <div
          class="h-full flex-none bg-gray-400"
          :style="{ width: `${metadataStoragePercent}%` }"
          title="文本与索引"
        ></div>
      </div>
      <div
        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
      >
        <span class="inline-flex items-center gap-1">
          <span class="h-2 w-2 rounded-full bg-gray-900"></span>
          图片 {{ formatBytes(storageUsage.imageBytes) }}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="h-2 w-2 rounded-full bg-gray-400"></span>
          文本与索引 {{ formatBytes(storageUsage.metadataBytes) }}
        </span>
        <span v-if="storageUsage.quotaBytes" class="ml-auto">
          {{ storageUsedPercent.toFixed(1) }}%
        </span>
        <span v-else class="ml-auto">浏览器未提供上限</span>
      </div>
    </div>
  </div>
</template>
