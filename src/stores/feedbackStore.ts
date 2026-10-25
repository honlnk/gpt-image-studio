import { ref } from "vue";
import { defineStore } from "pinia";

export type StudioNoticeType = "success" | "error" | "info" | "warning";

export type StudioNotice = {
  id: number;
  type: StudioNoticeType;
  message: string;
};

/** 阻断性错误横幅上的可点动作（如「去设置」「重试」）。 */
export type StudioNoticeAction = {
  label: string;
  /** solid=实底主按钮，outline=描边次按钮。 */
  tone?: "solid" | "outline";
  handler: () => void;
};

export type StudioErrorBanner = {
  id: number;
  message: string;
  actions: StudioNoticeAction[];
};

export type StudioConfirmDialog = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default";
};

export const useFeedbackStore = defineStore("feedback", () => {
  // 底部轻提示：成功/常规信息等非阻断反馈，短时自动消失。
  const notice = ref<StudioNotice | null>(null);
  // 顶部错误横幅：生成失败等阻断性错误，带动作按钮，常驻直到用户处理或关闭。
  const errorBanner = ref<StudioErrorBanner | null>(null);
  const confirmDialog = ref<StudioConfirmDialog | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmDialogResolver: ((confirmed: boolean) => void) | null = null;

  function dismissNotice() {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    notice.value = null;
  }

  function dismissErrorBanner() {
    errorBanner.value = null;
  }

  function notifyErrorBanner(
    message: string,
    actions: StudioNoticeAction[] = [],
  ) {
    errorBanner.value = {
      id: Date.now(),
      message,
      actions,
    };
  }

  function cancelConfirmDialog() {
    resolveConfirmDialog(false);
  }

  function acceptConfirmDialog() {
    resolveConfirmDialog(true);
  }

  function requestConfirmation(input: StudioConfirmDialog) {
    if (confirmDialogResolver) {
      confirmDialogResolver(false);
    }

    confirmDialog.value = input;
    return new Promise<boolean>((resolve) => {
      confirmDialogResolver = resolve;
    });
  }

  function resolveConfirmDialog(confirmed: boolean) {
    confirmDialog.value = null;
    confirmDialogResolver?.(confirmed);
    confirmDialogResolver = null;
  }

  function notifySuccess(message: string) {
    setNotice("success", message);
  }

  function notifyError(message: string) {
    setNotice("error", message);
  }

  function notifyInfo(message: string) {
    setNotice("info", message);
  }

  function notifyWarning(message: string) {
    setNotice("warning", message);
  }

  function setNotice(type: StudioNoticeType, message: string) {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
    }
    notice.value = {
      id: Date.now(),
      type,
      message,
    };
    noticeTimer = setTimeout(() => {
      notice.value = null;
      noticeTimer = null;
    }, noticeDuration(type));
  }

  // 底部轻提示宁短勿长：常规确认快速消失，失败/警示类略长保证能读完。
  function noticeDuration(type: StudioNoticeType) {
    switch (type) {
      case "error":
        return 3000;
      case "warning":
        return 2500;
      default:
        return 1500;
    }
  }

  return {
    acceptConfirmDialog,
    cancelConfirmDialog,
    confirmDialog,
    dismissErrorBanner,
    dismissNotice,
    errorBanner,
    notice,
    notifyError,
    notifyErrorBanner,
    notifyInfo,
    notifySuccess,
    notifyWarning,
    requestConfirmation,
  };
});
