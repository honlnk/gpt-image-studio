<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useCompanionStore } from "../stores/companionStore";
import { useSettingsStore } from "../stores/settingsStore";
import CompanionPanel from "../components/settings/CompanionPanel.vue";

/**
 * /companion 独立管理页：全屏挂载 CompanionPanel。
 *
 * 状态全部来自 companionStore（与工作台共享的单例），页面本身只做布局 + 绑定。
 * companionUrl / companionSessionToken / companionPaired 在 settingsStore 持有（localStorage 持久化），
 * 这里通过 storeToRefs 响应式读取。
 */
const companion = useCompanionStore();
const settings = useSettingsStore();

const {
  presets,
  credentials,
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
  pairingInProgress,
  pairingError,
  pairingCodeInput,
} = storeToRefs(companion);

const { companionUrl, companionSessionToken, companionPaired } = storeToRefs(settings);

function onUpdatePairingCodeInput(value: string) {
  companion.pairingCodeInput = value;
}
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
        :companion-session-token="companionSessionToken"
        :companion-paired="companionPaired"
        :companion-online="companionOnline"
        :companion-health="companionHealth"
        :companion-auth-status="companionAuthStatus"
        :companion-pairing-in-progress="pairingInProgress"
        :companion-pairing-error="pairingError"
        :companion-pairing-code-input="pairingCodeInput"
        :presets="presets"
        :credentials="credentials"
        :logs="logs"
        :loading-presets="loadingPresets"
        :loading-credentials="loadingCredentials"
        :saving-credentials="savingCredentials"
        :logs-loading="logsLoading"
        :cred-error="credError"
        :logs-error="logsError"
        @update:companion-pairing-code-input="onUpdatePairingCodeInput"
        @check-status="companion.checkStatus"
        @start-pairing="companion.startPairing"
        @confirm-pairing="companion.confirmPairing"
        @disconnect-companion="companion.disconnect"
        @cancel-pairing="companion.cancelPairing"
        @load-presets="companion.loadPresets"
        @load-credentials="companion.loadCredentials"
        @submit-credentials="companion.submitCredentials"
        @remove-credentials="companion.removeCredentials"
        @load-logs="companion.loadLogs"
      />
    </main>
  </div>
</template>
