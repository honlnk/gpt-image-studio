<script setup lang="ts">
defineProps<{
  autoRetryOnNetworkError: boolean;
}>();

const emit = defineEmits<{
  "update:autoRetryOnNetworkError": [value: boolean];
}>();
</script>

<template>
  <section aria-labelledby="generalSettingsTitle">
    <h3 id="generalSettingsTitle" class="text-base font-semibold text-gray-900">
      通用
    </h3>

    <div class="mt-4 space-y-4">
      <div class="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-3 py-2.5">
        <div>
          <div class="text-sm font-medium text-gray-700">网络失败自动重试</div>
          <p class="mt-1 text-xs leading-relaxed text-gray-500">
            开启后，当网络连接失败时会自动重试（指数退避，最多 10 次）。
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
