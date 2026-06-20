import { ref, watch } from "vue";
import type { Ref } from "vue";
import {
  checkCompanionHealth,
  getCompanionAuthStatus,
  getCompanionAuthStatusResult,
  startPairing,
  confirmPairing,
  unpairCompanion,
} from "../../services/companionApi";
import type {
  CompanionAuthStatus,
  CompanionHealthResponse,
} from "../../types/companion";
import type { ConnectionMode } from "../../types/studio";

type UseCompanionConnectionInput = {
  connectionMode: Ref<ConnectionMode>;
  companionUrl: Ref<string>;
  companionSessionToken: Ref<string>;
  /**
   * token 失效（401）/配对已失效时清空持久化的 sessionToken。
   * 由 view model 注入（实际是写 settingsStore.companionSessionToken）。
   */
  onClearSessionToken: () => void;
  /** 回流 provider 元信息（model/capability/sizeConstraints）驱动 UI。 */
  onApplyProviderInfo: (status: CompanionAuthStatus | null) => void;
  /** 配对成功时持久化新 sessionToken（view model 写 settingsStore）。 */
  onSessionTokenAcquired: (token: string) => void;
};

/**
 * 全局唯一的 Companion 连接状态源。
 *
 * 历史问题：连接探测（/health → /auth/status → applyProviderInfo）曾只存在于
 * ApiSettingsPanel.vue 的 onMounted/checkStatus 里，而该面板是惰性挂载的
 * （被 SettingsModal 的 v-if="isOpen" + 自身 activeTab==='api' 双重拦截）。
 * 结果页面刷新后即便 connectionMode 已恢复为 localCompanion，也不会发探测请求，
 * providerCapability 一直停在 OpenAI 默认值——必须打开「设置 → 接口」才回流。
 *
 * 本 composable 把探测时机提升到 view model 层：onMounted + connectionMode/token
 * watch，任何挂载它的组件都会触发，不再依赖设置面板是否打开。
 */
export function useCompanionConnection(input: UseCompanionConnectionInput) {
  const companionOnline = ref(false);
  const companionHealth = ref<CompanionHealthResponse | null>(null);
  const companionAuthStatus = ref<CompanionAuthStatus | null>(null);
  const pairingInProgress = ref(false);
  const pairingError = ref("");
  // 配对码输入框是局部交互态，仍由消费组件双向绑定最直接；这里持有方便测试。
  const pairingCodeInput = ref("");

  async function checkStatus() {
    const health = await checkCompanionHealth(input.companionUrl.value);
    companionHealth.value = health;
    companionOnline.value = health !== null;

    if (!health || !input.companionSessionToken.value) {
      companionAuthStatus.value = null;
      input.onApplyProviderInfo(null);
      return;
    }

    if (!health.paired) {
      input.onClearSessionToken();
      companionAuthStatus.value = null;
      input.onApplyProviderInfo(null);
      pairingInProgress.value = false;
      pairingCodeInput.value = "";
      pairingError.value =
        "检测到本地 Companion 配对已失效，已清除浏览器里的旧会话，请重新配对。";
      return;
    }

    const authResult = await getCompanionAuthStatusResult(
      input.companionUrl.value,
      input.companionSessionToken.value,
    );

    if (authResult.ok) {
      companionAuthStatus.value = authResult.status;
      input.onApplyProviderInfo(authResult.status);
      return;
    }

    companionAuthStatus.value = null;
    input.onApplyProviderInfo(null);
    if (authResult.invalidToken) {
      input.onClearSessionToken();
      pairingInProgress.value = false;
      pairingCodeInput.value = "";
      pairingError.value =
        "检测到本地 Companion 拒绝了旧 token，已清除浏览器会话，请重新配对。";
    }
  }

  async function startPairingFlow() {
    pairingError.value = "";
    pairingCodeInput.value = "";
    try {
      await startPairing(input.companionUrl.value);
      pairingInProgress.value = true;
    } catch (error) {
      pairingError.value =
        error instanceof Error ? error.message : "无法连接 Companion 服务";
    }
  }

  async function confirmPairingFlow() {
    pairingError.value = "";
    try {
      const result = await confirmPairing(
        input.companionUrl.value,
        pairingCodeInput.value,
      );
      input.onSessionTokenAcquired(result.sessionToken);
      pairingInProgress.value = false;
      const status = await getCompanionAuthStatus(
        input.companionUrl.value,
        result.sessionToken,
      );
      companionAuthStatus.value = status;
      input.onApplyProviderInfo(status);
    } catch {
      pairingError.value = "配对码无效或已过期";
    }
  }

  async function disconnect() {
    pairingError.value = "";
    const health = await checkCompanionHealth(input.companionUrl.value);
    companionHealth.value = health;
    companionOnline.value = health !== null;
    if (!health) {
      pairingError.value =
        "Companion 离线，无法确认断开连接。请先启动 Companion 后再断开。";
      return;
    }

    try {
      await unpairCompanion(
        input.companionUrl.value,
        input.companionSessionToken.value,
      );
    } catch {
      pairingError.value = "断开失败，Companion 未确认清除本地 session。";
      return;
    }

    input.onClearSessionToken();
    companionAuthStatus.value = null;
    await checkStatus();
  }

  function cancelPairing() {
    pairingInProgress.value = false;
    pairingCodeInput.value = "";
    pairingError.value = "";
  }

  // 切到 Companion 模式（含初始 localCompanion）时立即探测：immediate=true
  // 覆盖启动场景，无需依赖组件 onMounted。脱组件调用（view model 直接用）也能工作。
  watch(
    () => input.connectionMode.value,
    (mode) => {
      if (mode === "localCompanion") void checkStatus();
    },
    { immediate: true },
  );

  watch(
    () => input.companionSessionToken.value,
    () => {
      if (input.connectionMode.value === "localCompanion") void checkStatus();
    },
  );

  return {
    companionOnline,
    companionHealth,
    companionAuthStatus,
    pairingInProgress,
    pairingError,
    pairingCodeInput,
    checkStatus,
    startPairing: startPairingFlow,
    confirmPairing: confirmPairingFlow,
    disconnect,
    cancelPairing,
  };
}
