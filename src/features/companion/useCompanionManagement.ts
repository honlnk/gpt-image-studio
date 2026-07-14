import { ref } from "vue";
import type { Ref } from "vue";
import {
  getCompanionPresets,
  getCompanionCredentials,
  saveCompanionCredentials,
  clearCompanionCredentials,
  getCompanionLogs,
} from "../../services/companionApi";
import type {
  CompanionProviderPreset,
  CompanionCredentialsView,
  CompanionLogsTailResponse,
} from "../../types/companion";

type UseCompanionManagementInput = {
  /** companion 基地址，reactive（通常来自 settingsStore.companionUrl）。 */
  companionUrl: Ref<string>;
  /** 连接密钥，reactive；日志接口需要它。 */
  companionAccessKey: Ref<string>;
  /**
   * 凭证变化后回调（通常指向 useCompanionConnection.checkStatus）。
   * 让 /auth/status 重新拉取，provider 能力/尺寸约束即时刷新。
   */
  onCredentialsChanged: () => void;
};

/**
 * Companion 管理面板的状态机：凭证（替代 CLI login）+ 日志（替代 CLI logs）。
 *
 * 与 useCompanionConnection 并列、不合并：后者管连接/健康探测，已稳定；
 * 本 composable 只服务管理面板，职责清晰、互不耦合。
 * 面板挂载时按需 loadPresets/loadCredentials；日志在面板内显式触发。
 */
export function useCompanionManagement(input: UseCompanionManagementInput) {
  const presets = ref<CompanionProviderPreset[]>([]);
  const credentials = ref<CompanionCredentialsView | null>(null);
  const logs = ref<CompanionLogsTailResponse | null>(null);

  const loadingPresets = ref(false);
  const loadingCredentials = ref(false);
  const savingCredentials = ref(false);
  const logsLoading = ref(false);
  const credError = ref("");
  const logsError = ref("");

  async function loadPresets() {
    loadingPresets.value = true;
    try {
      presets.value = await getCompanionPresets(input.companionUrl.value);
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "无法获取 provider 列表";
    } finally {
      loadingPresets.value = false;
    }
  }

  async function loadCredentials() {
    loadingCredentials.value = true;
    credError.value = "";
    try {
      credentials.value = await getCompanionCredentials(input.companionUrl.value);
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "无法获取当前凭据";
    } finally {
      loadingCredentials.value = false;
    }
  }

  async function submitCredentials(form: {
    provider?: string;
    apiBaseUrl: string;
    apiKey: string;
    model?: string;
  }) {
    savingCredentials.value = true;
    credError.value = "";
    try {
      const result = await saveCompanionCredentials(input.companionUrl.value, form);
      credentials.value = {
        hasApiKey: true,
        provider: form.provider,
        apiBaseUrl: form.apiBaseUrl,
        model: form.model,
        accountLabel: result.accountLabel,
        savedAt: new Date().toISOString(),
      };
      // 通知连接层重新拉 /auth/status，让能力/尺寸约束即时刷新。
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "保存凭据失败";
      throw e;
    } finally {
      savingCredentials.value = false;
    }
  }

  async function removeCredentials() {
    credError.value = "";
    try {
      await clearCompanionCredentials(input.companionUrl.value);
      credentials.value = { hasApiKey: false, accountLabel: "" };
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "清除凭据失败";
    }
  }

  async function loadLogs(params: { lines?: number; date?: string } = {}) {
    if (!input.companionAccessKey.value) {
      logsError.value = "需要先连接 Companion 才能查看日志";
      return;
    }
    logsLoading.value = true;
    logsError.value = "";
    try {
      logs.value = await getCompanionLogs(
        input.companionUrl.value,
        input.companionAccessKey.value,
        params,
      );
    } catch (e) {
      logsError.value = e instanceof Error ? e.message : "无法获取日志";
    } finally {
      logsLoading.value = false;
    }
  }

  return {
    presets,
    credentials,
    logs,
    loadingPresets,
    loadingCredentials,
    savingCredentials,
    logsLoading,
    credError,
    logsError,
    loadPresets,
    loadCredentials,
    submitCredentials,
    removeCredentials,
    loadLogs,
  };
}
