import { ref } from "vue";
import type { Ref } from "vue";
import {
  getCompanionPresets,
  listCompanionCredentials,
  addCompanionCredential,
  updateCompanionCredential,
  removeCompanionCredential,
  activateCompanionCredential,
  getCompanionLogs,
} from "../../services/companionApi";
import type {
  CompanionProviderPreset,
  CompanionCredentialEntry,
  CompanionCredentialInput,
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
 * Companion 管理面板的状态机：多配置凭据 CRUD（替代 CLI provider 命令）+ 日志。
 *
 * 凭据从单条改为列表：credentialList + activeCredentialId 替代旧的 credentials。
 * 每次增删改激活后调用 onCredentialsChanged，让连接层刷新 /auth/status。
 */
export function useCompanionManagement(input: UseCompanionManagementInput) {
  const presets = ref<CompanionProviderPreset[]>([]);
  const credentialList = ref<CompanionCredentialEntry[]>([]);
  const activeCredentialId = ref<string | null>(null);
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
      const data = await listCompanionCredentials(input.companionUrl.value);
      credentialList.value = Array.isArray(data.entries) ? data.entries : [];
      activeCredentialId.value = data.activeId ?? null;
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "无法获取凭据列表";
    } finally {
      loadingCredentials.value = false;
    }
  }

  async function addCredential(form: CompanionCredentialInput) {
    savingCredentials.value = true;
    credError.value = "";
    try {
      const entry = await addCompanionCredential(input.companionUrl.value, form);
      credentialList.value = [...credentialList.value, entry];
      // 服务端可能自动激活首条，重新拉一次保证 activeId 同步
      await syncActiveId();
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "新增凭据失败";
      throw e;
    } finally {
      savingCredentials.value = false;
    }
  }

  async function updateCredential(id: string, form: CompanionCredentialInput) {
    savingCredentials.value = true;
    credError.value = "";
    try {
      const entry = await updateCompanionCredential(input.companionUrl.value, id, form);
      credentialList.value = credentialList.value.map((e) => (e.id === id ? entry : e));
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "更新凭据失败";
      throw e;
    } finally {
      savingCredentials.value = false;
    }
  }

  async function removeCredential(id: string) {
    credError.value = "";
    try {
      await removeCompanionCredential(input.companionUrl.value, id);
      credentialList.value = credentialList.value.filter((e) => e.id !== id);
      // 删激活项后服务端可能自动切到剩余首条，重新拉一次
      await syncActiveId();
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "删除凭据失败";
    }
  }

  async function activateCredential(id: string) {
    credError.value = "";
    try {
      await activateCompanionCredential(input.companionUrl.value, id);
      activeCredentialId.value = id;
      input.onCredentialsChanged();
    } catch (e) {
      credError.value = e instanceof Error ? e.message : "激活凭据失败";
    }
  }

  /**
   * 从服务端同步 activeId——add/remove 后服务端可能自动切换激活项，
   * 本地不能盲猜，拉一次最准确。
   */
  async function syncActiveId() {
    try {
      const data = await listCompanionCredentials(input.companionUrl.value);
      activeCredentialId.value = data.activeId;
    } catch {
      // 同步失败不阻塞主流程，credError 已由上层设置
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
    credentialList,
    activeCredentialId,
    logs,
    loadingPresets,
    loadingCredentials,
    savingCredentials,
    logsLoading,
    credError,
    logsError,
    loadPresets,
    loadCredentials,
    addCredential,
    updateCredential,
    removeCredential,
    activateCredential,
    loadLogs,
  };
}
