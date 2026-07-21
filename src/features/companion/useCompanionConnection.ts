import { ref, watch } from "vue";
import type { Ref } from "vue";
import {
  checkCompanionHealth,
  getCompanionAuthStatus,
  getCompanionAuthStatusResult,
} from "../../services/companionApi";
import type {
  CompanionAuthStatus,
  CompanionHealthResponse,
} from "../../types/companion";
import type { ConnectionMode } from "../../types/studio";

type UseCompanionConnectionInput = {
  connectionMode: Ref<ConnectionMode>;
  companionUrl: Ref<string>;
  companionAccessKey: Ref<string>;
  /**
   * 连接密钥失效（401）/被用户断开时清空持久化的 accessKey。
   * 由 view model 注入（实际是写 settingsStore.companionAccessKey）。
   */
  onClearAccessKey: () => void;
  /** 回流 provider 元信息（model/capability/sizeConstraints）驱动 UI。 */
  onApplyProviderInfo: (status: CompanionAuthStatus | null) => void;
  /** 切回浏览器直连时恢复 OpenAI 默认能力和固定模型。 */
  onApplyDirectProviderInfo: () => void;
  /** 用户粘贴密钥连接成功时持久化 accessKey（view model 写 settingsStore）。 */
  onAccessKeyAcquired: (key: string) => void;
};

/**
 * 全局唯一的 Companion 连接状态源。
 *
 * 用户在网页粘贴 Companion 启动时打印的连接密钥完成连接——没有配对仪式。
 * 密钥存 localStorage（settingsStore），每次探测 /auth/status 时用它做 Bearer 认证，
 * 401 说明密钥不对（或被 reset-key 重置了），清掉让用户重新粘。
 */
export function useCompanionConnection(input: UseCompanionConnectionInput) {
  const companionOnline = ref(false);
  const companionHealth = ref<CompanionHealthResponse | null>(null);
  const companionAuthStatus = ref<CompanionAuthStatus | null>(null);
  const connectError = ref("");
  const connecting = ref(false);

  function applyProviderInfoForActiveMode(status: CompanionAuthStatus | null) {
    if (input.connectionMode.value === "localCompanion") {
      input.onApplyProviderInfo(status);
    }
  }

  async function checkStatus() {
    const health = await checkCompanionHealth(input.companionUrl.value);
    companionHealth.value = health;
    companionOnline.value = health !== null;

    if (!health || !input.companionAccessKey.value) {
      companionAuthStatus.value = null;
      applyProviderInfoForActiveMode(null);
      return;
    }

    const authResult = await getCompanionAuthStatusResult(
      input.companionUrl.value,
      input.companionAccessKey.value,
    );

    if (authResult.ok) {
      // 凭据文件损坏时 /auth/status 返 200 + corrupt:true + error（含备份路径）。
      // companionAuthStatus 仍正常 set（ready:false），但额外把损坏原因塞进
      // connectError，让用户在连接区红字看到具体原因——和 credError 通道互补。
      if (authResult.status.corrupt && authResult.status.error) {
        connectError.value = authResult.status.error;
      }
      companionAuthStatus.value = authResult.status;
      applyProviderInfoForActiveMode(authResult.status);
      return;
    }

    companionAuthStatus.value = null;
    applyProviderInfoForActiveMode(null);
    if (authResult.invalidToken) {
      input.onClearAccessKey();
      connectError.value =
        "Companion 拒绝了当前密钥（可能已通过 reset-key 重置），已清除浏览器里的旧密钥。";
    }
  }

  /**
   * 用户在网页粘贴连接密钥后调用。
   * 存入 settingsStore，然后立即探测 /auth/status 验证——200 就是连上了，401 就是密钥错。
   */
  async function connectWithKey(key: string) {
    connectError.value = "";
    const trimmed = key.trim();
    if (!trimmed) {
      connectError.value = "请输入连接密钥。";
      return;
    }

    connecting.value = true;
    try {
      input.onAccessKeyAcquired(trimmed);

      const health = await checkCompanionHealth(input.companionUrl.value);
      companionHealth.value = health;
      companionOnline.value = health !== null;

      if (!health) {
        input.onClearAccessKey();
        connectError.value = "无法连接 Companion 服务，请确认它正在运行。";
        return;
      }

      const status = await getCompanionAuthStatus(
        input.companionUrl.value,
        trimmed,
      );
      if (!status) {
        input.onClearAccessKey();
        connectError.value = "连接密钥无效，请核对后重试。";
        return;
      }

      companionAuthStatus.value = status;
      applyProviderInfoForActiveMode(status);
    } catch {
      input.onClearAccessKey();
      connectError.value = "连接失败，请确认 Companion 在线且密钥正确。";
    } finally {
      connecting.value = false;
    }
  }

  /**
   * 断开连接：纯前端操作，清 localStorage 里的密钥。
   * 不需要调后端——密钥是持久的，后端没有「撤销单个会话」的概念。
   */
  function disconnect() {
    input.onClearAccessKey();
    companionAuthStatus.value = null;
    applyProviderInfoForActiveMode(null);
    connectError.value = "";
  }

  // 切到 Companion 模式（含初始 localCompanion）时立即探测：immediate=true
  // 覆盖启动场景，无需依赖组件 onMounted。脱组件调用（view model 直接用）也能工作。
  watch(
    () => input.connectionMode.value,
    (mode) => {
      if (mode === "localCompanion") {
        void checkStatus();
      } else {
        input.onApplyDirectProviderInfo();
      }
    },
    { immediate: true },
  );

  watch(
    () => input.companionAccessKey.value,
    () => {
      if (input.connectionMode.value === "localCompanion") void checkStatus();
    },
  );

  return {
    companionOnline,
    companionHealth,
    companionAuthStatus,
    connectError,
    connecting,
    checkStatus,
    connectWithKey,
    disconnect,
  };
}
