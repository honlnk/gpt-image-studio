import { defineStore } from "pinia";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "./settingsStore";
import { useCompanionConnection } from "../features/companion";

/**
 * Companion 连接状态的共享 store（单例）。
 *
 * 阶段零之后，provider 凭据管理已迁移到 Companion 自带管理页（127.0.0.1:19750/admin），
 * 本 store 只保留 connection 半边——驱动工作台的 Companion 状态徽标和 localCompanion 模式
 * 下的 provider 能力感知。凭据 CRUD、损坏恢复、日志查看都不再由 Web 项目承载。
 *
 * 为什么是 store 而不是 composable：
 * useCompanionConnection 每次调用返回新实例（独立的 reactive 状态、独立的 watch 探活轮询）。
 * 多个组件各自实例化会重复探活、状态割裂。Pinia store 是单例，所有消费者拿到同一份状态。
 *
 * 与 settingsStore 的关系：
 * - 连接所需的 companionUrl / companionAccessKey / connectionMode 仍由 settingsStore 持有
 *   （它们是持久化在 localStorage 的应用级设置）。
 * - onApplyProviderInfo 回调指向 settingsStore.applyProviderInfo——它深度耦合 settingsStore
 *   内部的 providerCapability / 尺寸约束等 refs，留在那里不搬。
 * 本 store 只是把 settingsStore 的 reactive refs 喂给 composable，做"连接实例的宿主"。
 */
export const useCompanionStore = defineStore("companion", () => {
  const settings = useSettingsStore();
  // storeToRefs 拿到的是响应式 Ref，composable 需要的就是 Ref 输入。
  // applyProviderInfo 是普通 function，不参与 storeToRefs，直接从 store 取。
  const { connectionMode, companionUrl, companionAccessKey } = storeToRefs(settings);

  const connection = useCompanionConnection({
    connectionMode,
    companionUrl,
    companionAccessKey,
    onClearAccessKey: () => {
      settings.companionAccessKey = "";
    },
    onApplyProviderInfo: settings.applyProviderInfo,
    onApplyDirectProviderInfo: settings.applyDirectProviderInfo,
    onAccessKeyAcquired: (key) => {
      settings.companionAccessKey = key;
    },
  });

  return {
    // 连接状态（useCompanionConnection）
    companionOnline: connection.companionOnline,
    companionHealth: connection.companionHealth,
    companionAuthStatus: connection.companionAuthStatus,
    connectError: connection.connectError,
    connecting: connection.connecting,
    checkStatus: connection.checkStatus,
    connectWithKey: connection.connectWithKey,
    disconnect: connection.disconnect,
  };
});
