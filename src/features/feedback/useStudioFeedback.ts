import { storeToRefs } from "pinia";
import { useFeedbackStore } from "../../stores/feedbackStore";

export function useStudioFeedback() {
  const feedback = useFeedbackStore();
  const refs = storeToRefs(feedback);

  return {
    ...refs,
    acceptConfirmDialog: feedback.acceptConfirmDialog,
    cancelConfirmDialog: feedback.cancelConfirmDialog,
    dismissErrorBanner: feedback.dismissErrorBanner,
    dismissNotice: feedback.dismissNotice,
    notifyError: feedback.notifyError,
    notifyErrorBanner: feedback.notifyErrorBanner,
    notifyInfo: feedback.notifyInfo,
    notifySuccess: feedback.notifySuccess,
    notifyWarning: feedback.notifyWarning,
    requestConfirmation: feedback.requestConfirmation,
  };
}
