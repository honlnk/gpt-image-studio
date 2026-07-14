import { defineStore } from "pinia";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "./settingsStore";
import { useCompanionConnection, useCompanionManagement } from "../features/companion";

/**
 * Companion 连接 + 管理的共享状态（单例 store）。
 *
 * 为什么是 store 而不是 composable：
 * useCompanionConnection / useCompanionManagement 每次调用返回新实例（独立的 reactive 状态、
 * 独立的 watch 探活轮询）。工作台和 /companion 管理页如果各自实例化，就会双份探活、
 * 状态割裂（在一处配对了，另一处不知道）。Pinia store 是单例，两个页面拿到同一份状态。
 *
 * 与 settingsStore 的关系：
 * - 连接所需的 companionUrl / companionSessionToken / connectionMode 仍由 settingsStore 持有
 *   （它们是持久化在 localStorage 的应用级设置）。
 * - onApplyProviderInfo 回调指向 settingsStore.applyProviderInfo——它深度耦合 settingsStore
 *   内部的 providerCapability / 尺寸约束等 refs，留在那里不搬。
 * 本 store 只是把 settingsStore 的 reactive refs 喂给 composable，做"连接实例的宿主"。
 */
export const useCompanionStore = defineStore("companion", () => {
  const settings = useSettingsStore();
  // storeToRefs 拿到的是响应式 Ref，composable 需要的就是 Ref 输入。
  // applyProviderInfo 是普通 function，不参与 storeToRefs，直接从 store 取。
  const { connectionMode, companionUrl, companionSessionToken } = storeToRefs(settings);

  const connection = useCompanionConnection({
    connectionMode,
    companionUrl,
    companionSessionToken,
    onClearSessionToken: () => {
      settings.companionSessionToken = "";
    },
    onApplyProviderInfo: settings.applyProviderInfo,
    onSessionTokenAcquired: (token) => {
      settings.companionSessionToken = token;
    },
  });

  const management = useCompanionManagement({
    companionUrl,
    companionSessionToken,
    onCredentialsChanged: () => {
      void connection.checkStatus();
    },
  });

  return {
    // 连接状态（useCompanionConnection）
    companionOnline: connection.companionOnline,
    companionHealth: connection.companionHealth,
    companionAuthStatus: connection.companionAuthStatus,
    pairingInProgress: connection.pairingInProgress,
    pairingError: connection.pairingError,
    pairingCodeInput: connection.pairingCodeInput,
    checkStatus: connection.checkStatus,
    startPairing: connection.startPairing,
    confirmPairing: connection.confirmPairing,
    disconnect: connection.disconnect,
    cancelPairing: connection.cancelPairing,
    // 凭证 + 日志（useCompanionManagement）
    presets: management.presets,
    credentials: management.credentials,
    logs: management.logs,
    loadingPresets: management.loadingPresets,
    loadingCredentials: management.loadingCredentials,
    savingCredentials: management.savingCredentials,
    logsLoading: management.logsLoading,
    credError: management.credError,
    logsError: management.logsError,
    loadPresets: management.loadPresets,
    loadCredentials: management.loadCredentials,
    submitCredentials: management.submitCredentials,
    removeCredentials: management.removeCredentials,
    loadLogs: management.loadLogs,
  };
});
