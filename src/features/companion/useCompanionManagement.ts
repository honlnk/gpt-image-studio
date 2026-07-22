import { ref } from "vue";
import type { Ref } from "vue";
import {
  getCompanionPresets,
  listCompanionCredentials,
  addCompanionCredential,
  updateCompanionCredential,
  removeCompanionCredential,
  activateCompanionCredential,
  resetEmptyCredentialStore,
  restoreBackupCredentialStore,
  getCompanionLogs,
} from "../../services/companionApi";
import type {
  CompanionProviderPreset,
  CompanionCredentialEntry,
  CompanionCredentialInput,
  CompanionCorruptionEvent,
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

  /**
   * 凭据文件损坏事件。loadCredentials 收到 /credentials 的 500+corrupt 时设置，
   * 让 UI 渲染异常面板（隐藏 API 凭据/日志面板）。
   * reset/restore 成功后清空；restore 失败时 message 被覆盖为「恢复失败：xxx」，
   * 保留非空让用户继续看到异常面板。
   */
  const corruptEvent = ref<CompanionCorruptionEvent | null>(null);
  const loadingReset = ref(false);
  const loadingRestore = ref(false);

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
      // 成功加载 → 清除损坏事件（可能是 companion 端已恢复，或本来就是正常的）
      corruptEvent.value = null;
    } catch (e) {
      // 区分「凭据文件损坏」与「普通加载失败」：前者走异常面板，后者走 credError 红字。
      // listCompanionCredentials 在响应是 corrupt:true 时给 error attach corrupt 属性。
      if (e instanceof Error && (e as Error & { corrupt?: boolean }).corrupt) {
        corruptEvent.value = { message: e.message };
      } else {
        credError.value = e instanceof Error ? e.message : "无法获取凭据列表";
      }
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
   * 重置成空配置：写合法空 store + 清除损坏事件。
   * 成功后重新 loadCredentials + onCredentialsChanged；失败时把错误信息覆盖到 corruptEvent，
   * 让用户在异常面板原地看到「重置失败：xxx」，可继续尝试从备份恢复。
   */
  async function resetCredentialStore() {
    loadingReset.value = true;
    try {
      await resetEmptyCredentialStore(input.companionUrl.value);
      corruptEvent.value = null;
      await loadCredentials();
      input.onCredentialsChanged();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "重置凭据失败";
      corruptEvent.value = { message: `重置失败：${reason}` };
    } finally {
      loadingReset.value = false;
    }
  }

  /**
   * 从最近备份恢复：companion 找最新的 credentials.json.corrupt-{ts}.json 尝试恢复。
   * 成功后重新 loadCredentials + onCredentialsChanged；失败时把错误信息覆盖到 corruptEvent，
   * 保留异常面板让用户改试「重置成空配置」。
   */
  async function restoreCredentialBackup() {
    loadingRestore.value = true;
    try {
      await restoreBackupCredentialStore(input.companionUrl.value);
      corruptEvent.value = null;
      await loadCredentials();
      input.onCredentialsChanged();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "恢复备份失败";
      corruptEvent.value = { message: `恢复失败：${reason}` };
    } finally {
      loadingRestore.value = false;
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
    corruptEvent,
    loadingReset,
    loadingRestore,
    loadPresets,
    loadCredentials,
    addCredential,
    updateCredential,
    removeCredential,
    activateCredential,
    resetCredentialStore,
    restoreCredentialBackup,
    loadLogs,
  };
}
