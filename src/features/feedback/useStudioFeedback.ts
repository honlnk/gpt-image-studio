import { storeToRefs } from "pinia";
import { useFeedbackStore } from "../../stores/feedbackStore";

export function useStudioFeedback() {
  const feedback = useFeedbackStore();
  const refs = storeToRefs(feedback);

  return {
    ...refs,
    acceptConfirmDialog: feedback.acceptConfirmDialog,
    cancelConfirmDialog: feedback.cancelConfirmDialog,
    dismissNotice: feedback.dismissNotice,
    notifyError: feedback.notifyError,
    notifySuccess: feedback.notifySuccess,
    requestConfirmation: feedback.requestConfirmation,
  };
}
