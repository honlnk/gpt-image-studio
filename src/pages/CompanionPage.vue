<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useCompanionStore } from "../stores/companionStore";
import { useSettingsStore } from "../stores/settingsStore";
import CompanionPanel from "../components/settings/CompanionPanel.vue";

/**
 * /companion 独立管理页：全屏挂载 CompanionPanel。
 *
 * 状态全部来自 companionStore（与工作台共享的单例），页面本身只做布局 + 绑定。
 * companionUrl / companionAccessKey / companionConnected 在 settingsStore 持有（localStorage 持久化），
 * 这里通过 storeToRefs 响应式读取。
 */
const companion = useCompanionStore();
const settings = useSettingsStore();

const {
  presets,
  credentialList,
  activeCredentialId,
  logs,
  loadingPresets,
  loadingCredentials,
  savingCredentials,
  logsLoading,
  credError,
  logsError,
  companionOnline,
  companionHealth,
  companionAuthStatus,
  connectError,
  connecting,
} = storeToRefs(companion);

const { companionUrl, companionAccessKey, companionConnected } = storeToRefs(settings);

// 页面刷新后无论工作台处于 direct 还是 localCompanion 模式，管理页都需要探测
// Companion 是否在线——useCompanionConnection 的 watch 只在 localCompanion 模式下触发。
onMounted(() => {
  companion.checkStatus();
});
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <h1 class="text-lg font-semibold text-gray-900">Companion 管理</h1>
        <a
          href="/"
          class="text-sm text-gray-500 transition-colors hover:text-gray-900"
        >
          ← 返回工作台
        </a>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-6 py-8">
      <CompanionPanel
        :companion-url="companionUrl"
        :companion-access-key="companionAccessKey"
        :companion-connected="companionConnected"
        :companion-online="companionOnline"
        :companion-health="companionHealth"
        :companion-auth-status="companionAuthStatus"
        :connect-error="connectError"
        :connecting="connecting"
        :presets="presets"
        :credential-list="credentialList"
        :active-credential-id="activeCredentialId"
        :logs="logs"
        :loading-presets="loadingPresets"
        :loading-credentials="loadingCredentials"
        :saving-credentials="savingCredentials"
        :logs-loading="logsLoading"
        :cred-error="credError"
        :logs-error="logsError"
        @check-status="companion.checkStatus"
        @connect-with-key="companion.connectWithKey"
        @disconnect-companion="companion.disconnect"
        @load-presets="companion.loadPresets"
        @load-credentials="companion.loadCredentials"
        @add-credential="companion.addCredential"
        @update-credential="companion.updateCredential"
        @remove-credential="companion.removeCredential"
        @activate-credential="companion.activateCredential"
        @load-logs="companion.loadLogs"
      />
    </main>
  </div>
</template>
