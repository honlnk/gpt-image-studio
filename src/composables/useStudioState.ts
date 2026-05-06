import { onMounted, ref, watch } from "vue";
import { useStudioBackup } from "./useStudioBackup";
import { useStudioConversations } from "./useStudioConversations";
import { useStudioFeedback } from "./useStudioFeedback";
import { useStudioGeneration } from "./useStudioGeneration";
import { useStudioImages } from "./useStudioImages";
import { useStudioRestore } from "./useStudioRestore";
import { useStudioSettings } from "./useStudioSettings";
import { useStudioUiState } from "./useStudioUiState";
import type { Message } from "../types/studio";

const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
} as const;

export function useStudioState() {
  const isHydrated = ref(false);
  const {
    activeSizePreset,
    apiBaseUrl,
    apiKey,
    applySettings,
    applySizePreset,
    background,
    backgroundLabel,
    backgroundOptions,
    currentGenerationParams,
    customSizeError,
    formatLabel,
    formatOptions,
    imageHeight,
    imageWidth,
    model,
    outputFormat,
    quality,
    qualityLabel,
    qualityOptions,
    saveCurrentSettings,
    sizeLabel,
    sizePresets,
  } = useStudioSettings({
    isHydrated,
    onStorageError: reportStorageError,
  });
  const {
    activeEditor,
    closeAllEditors,
    closeSettings,
    isEditorExpanded,
    isLibraryOpen,
    isSettingsOpen,
    openSettings,
    toggleEditor,
  } = useStudioUiState();
  const composerText = ref(readStorage(STORAGE_KEYS.draftComposerText, ""));

  const messages = ref<Message[]>([]);
  const {
    acceptConfirmDialog,
    cancelConfirmDialog,
    confirmDialog,
    dismissNotice,
    notice,
    notifyError,
    notifySuccess,
    requestConfirmation,
  } = useStudioFeedback();
  const {
    activeConversation,
    activeConversationId,
    activeMessages,
    conversations,
    createConversation,
    createConversationRecord,
    deleteConversation,
    deleteConversations,
    persistConversation,
    selectConversation,
    updateConversationSummary,
  } = useStudioConversations({
    clearDraft: clearConversationDraft,
    messages,
    notifyError,
    notifySuccess,
    onStorageError: reportStorageError,
    refreshStorageUsage: refreshImagesStorageUsage,
    requestConfirmation,
  });
  const {
    activeAttachments,
    attachImage,
    attachedImages,
    deleteImage,
    deleteImages,
    hydrateImagePreviews,
    imageAssets,
    imageById,
    importImages,
    refreshStorageUsage,
    removeAttachment,
    storageUsage,
  } = useStudioImages({
    activeConversationId,
    messages,
    notifyError,
    notifySuccess,
    onStorageError: reportStorageError,
    requestConfirmation,
  });

  function clearConversationDraft() {
    attachedImages.value = [];
    composerText.value = "";
  }

  function refreshImagesStorageUsage() {
    return refreshStorageUsage();
  }

  const {
    canSend,
    imageModeLabel,
    isGenerating,
    retryMessage,
    submitMessage,
  } = useStudioGeneration({
    activeConversation,
    apiBaseUrl,
    apiKey,
    attachedImages,
    composerText,
    createConversationRecord,
    currentGenerationParams,
    customSizeError,
    imageAssets,
    imageById,
    messages,
    model,
    onStorageError: reportStorageError,
    persistConversation,
    refreshStorageUsage,
    updateConversationSummary,
  });
  const { restoreFromStorage } = useStudioRestore({
    activeConversationId,
    applySettings,
    attachedImages,
    conversations,
    hydrateImagePreviews,
    imageAssets,
    isHydrated,
    messages,
    notifyError,
    onStorageError: reportStorageError,
    refreshStorageUsage,
    saveCurrentSettings,
  });
  const { exportBackup, importBackup } = useStudioBackup({
    activeConversationId,
    attachedImages,
    composerText,
    conversations,
    imageAssets,
    messages,
    notifyError,
    notifySuccess,
    onStorageError: reportStorageError,
    restoreFromStorage,
  });

  onMounted(() => {
    void restoreFromStorage();
  });

  watch(composerText, (value) => {
    writeStorage(STORAGE_KEYS.draftComposerText, value);
  });

  return {
    activeAttachments,
    activeConversation,
    activeConversationId,
    activeEditor,
    activeMessages,
    activeSizePreset,
    apiBaseUrl,
    apiKey,
    background,
    backgroundLabel,
    backgroundOptions,
    canSend,
    cancelConfirmDialog,
    closeAllEditors,
    closeSettings,
    composerText,
    confirmDialog,
    conversations,
    createConversation,
    customSizeError,
    deleteConversation,
    deleteConversations,
    deleteImage,
    deleteImages,
    dismissNotice,
    formatLabel,
    formatOptions,
    imageAssets,
    imageById,
    imageHeight,
    imageModeLabel,
    imageWidth,
    exportBackup,
    importBackup,
    importImages,
    isEditorExpanded,
    isGenerating,
    isHydrated,
    isLibraryOpen,
    isSettingsOpen,
    messages,
    model,
    notice,
    openSettings,
    outputFormat,
    quality,
    qualityLabel,
    qualityOptions,
    removeAttachment,
    retryMessage,
    selectConversation,
    sizeLabel,
    sizePresets,
    storageUsage,
    submitMessage,
    toggleEditor,
    applySizePreset,
    attachImage,
    acceptConfirmDialog,
  };
}

function readStorage(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore local draft persistence failures.
  }
}

function reportStorageError(error: unknown) {
  console.error("Failed to access local studio storage.", error);
}
