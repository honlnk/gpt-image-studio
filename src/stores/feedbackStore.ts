import { ref } from "vue";
import { defineStore } from "pinia";

export type StudioNotice = {
  id: number;
  type: "success" | "error";
  message: string;
};

export type StudioConfirmDialog = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "default";
};

export const useFeedbackStore = defineStore("feedback", () => {
  const notice = ref<StudioNotice | null>(null);
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

  function setNotice(type: StudioNotice["type"], message: string) {
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
    }, type === "error" ? 7000 : 3500);
  }

  return {
    acceptConfirmDialog,
    cancelConfirmDialog,
    confirmDialog,
    dismissNotice,
    notice,
    notifyError,
    notifySuccess,
    requestConfirmation,
  };
});
