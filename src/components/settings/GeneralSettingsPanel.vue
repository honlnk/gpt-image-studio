<script setup lang="ts">
import type { ConnectionMode } from "../../types/studio";
import { useSettingsStore } from "../../stores/settingsStore";
import { useFeedbackStore } from "../../stores/feedbackStore";

const props = defineProps<{
  autoRetryOnNetworkError: boolean;
  connectionMode: ConnectionMode;
}>();

const emit = defineEmits<{
  "update:autoRetryOnNetworkError": [value: boolean];
  "update:connectionMode": [value: ConnectionMode];
}>();

const settings = useSettingsStore();
const feedback = useFeedbackStore();

const MODE_LABELS: Record<ConnectionMode, string> = {
  direct: "浏览器直连",
  localCompanion: "本地 Companion",
};

/**
 * 切换连接模式前先弹确认框：
 * 1) 说明数据隔离语义（切回可找回），对标 Companion 管理页切换存储位置的确认；
 * 2) reload 不可撤销，避免用户误点后页面猝不及防刷新。
 * 嵌入态 / 桌面内置态禁用切换（连接由宿主 / sidecar 固定）。
 */
async function handleSwitchMode(mode: ConnectionMode) {
  if (settings.isEmbedded || settings.isDesktopCompanion) return;
  const current = props.connectionMode;
  if (mode === current) return;
  const confirmed = await feedback.requestConfirmation({
    title: `切换到「${MODE_LABELS[mode]}」`,
    description: `切换后，当前「${MODE_LABELS[current]}」的内容将不可见（不会删除），新内容会存到新位置。切回「${MODE_LABELS[current]}」可找回原有内容。页面将自动重新加载以应用新模式。`,
    confirmLabel: "切换",
  });
  if (!confirmed) return;
  emit("update:connectionMode", mode);
}
</script>

<template>
  <section aria-labelledby="generalSettingsTitle">
    <h3 id="generalSettingsTitle" class="text-base font-semibold text-gray-900">
      通用
    </h3>

    <div class="mt-4 space-y-4">
      <!-- 嵌入态提示：连接配置由宿主注入，用户不可编辑 -->
      <div
        v-if="settings.isEmbedded"
        class="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-1"
      >
        <p class="text-sm font-medium text-blue-800">🔗 嵌入模式</p>
        <p class="text-xs leading-relaxed text-blue-700">
          当前作为子应用嵌入宿主系统运行，连接地址与认证令牌由宿主管控，无需手动配置。
        </p>
      </div>

      <!-- 桌面内置态提示：sidecar 随应用启动，连接自动建立 -->
      <div
        v-if="settings.isDesktopCompanion"
        class="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1"
      >
        <p class="text-sm font-medium text-green-800">🖥️ 桌面内置服务</p>
        <p class="text-xs leading-relaxed text-green-700">
          内置 Companion 服务随桌面应用自动启动并完成连接，数据与 npm CLI 版共享
          （~/.gpt-image-studio）。provider 凭据在管理页维护，无需手动配置连接。
        </p>
      </div>

      <div>
        <p class="mb-2 block text-sm font-medium text-gray-700">连接模式</p>
        <div class="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'direct' } }"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              connectionMode === 'direct'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
              settings.isEmbedded || settings.isDesktopCompanion ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]"
            type="button"
            :disabled="settings.isEmbedded || settings.isDesktopCompanion"
            @click="handleSwitchMode('direct')"
          >
            浏览器直连
          </button>
          <button
            v-track="{ name: 'settings.connection_mode_changed', payload: { mode: 'localCompanion' } }"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              connectionMode === 'localCompanion'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
              settings.isEmbedded || settings.isDesktopCompanion ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]"
            type="button"
            :disabled="settings.isEmbedded || settings.isDesktopCompanion"
            @click="handleSwitchMode('localCompanion')"
          >
            本地 Companion
          </button>
        </div>
        <p class="mt-1.5 text-xs leading-relaxed text-gray-500">
          切换连接模式后页面会自动重新加载，两种模式的数据互相隔离。
        </p>
      </div>

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
