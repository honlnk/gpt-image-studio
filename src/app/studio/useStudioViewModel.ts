import { computed, onMounted, proxyRefs, ref, watch } from "vue";
import { useStudioBackup, useStudioRestore } from "../../features/backup";
import { useStudioConversations } from "../../features/conversations";
import { useStudioFeedback } from "../../features/feedback";
import { useStudioGeneration } from "../../features/generation";
import { useStudioImages } from "../../features/images";
import { useStudioSettings } from "../../features/settings";
import { useStudioUiState } from "./useStudioUiState";
import type { Message } from "../../types/studio";

const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
} as const;

type SettingsTab = "api" | "backup" | "batch";
type BatchPanel = "images" | "conversations";

export function useStudioViewModel() {
  const isHydrated = ref(false);
  const settings = useStudioSettings({
    isHydrated,
    onStorageError: reportStorageError,
  });
  const ui = useStudioUiState();
  const composerText = ref(readStorage(STORAGE_KEYS.draftComposerText, ""));

  const messages = ref<Message[]>([]);
  const isConversationSidebarOpen = ref(false);
  const previewImageId = ref("");
  const settingsInitialTab = ref<SettingsTab>("api");
  const settingsInitialBatchPanel = ref<BatchPanel>("images");
  const feedback = useStudioFeedback();
  const conversations = useStudioConversations({
    clearDraft: clearConversationDraft,
    messages,
    notifyError: feedback.notifyError,
    notifySuccess: feedback.notifySuccess,
    onStorageError: reportStorageError,
    refreshStorageUsage: refreshImagesStorageUsage,
    requestConfirmation: feedback.requestConfirmation,
  });
  const images = useStudioImages({
    activeConversationId: conversations.activeConversationId,
    messages,
    notifyError: feedback.notifyError,
    notifySuccess: feedback.notifySuccess,
    onStorageError: reportStorageError,
    requestConfirmation: feedback.requestConfirmation,
  });

  function clearConversationDraft() {
    images.attachedImages.value = [];
    composerText.value = "";
  }

  function refreshImagesStorageUsage() {
    return images.refreshStorageUsage();
  }

  const generation = useStudioGeneration({
    activeConversation: conversations.activeConversation,
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    attachedImages: images.attachedImages,
    composerText,
    createConversationRecord: conversations.createConversationRecord,
    currentGenerationParams: settings.currentGenerationParams,
    customSizeError: settings.customSizeError,
    imageAssets: images.imageAssets,
    imageById: images.imageById,
    messages,
    model: settings.model,
    onStorageError: reportStorageError,
    persistConversation: conversations.persistConversation,
    refreshStorageUsage: images.refreshStorageUsage,
    updateConversationSummary: conversations.updateConversationSummary,
  });
  const { restoreFromStorage } = useStudioRestore({
    activeConversationId: conversations.activeConversationId,
    applySettings: settings.applySettings,
    attachedImages: images.attachedImages,
    conversations: conversations.conversations,
    hydrateImagePreviews: images.hydrateImagePreviews,
    imageAssets: images.imageAssets,
    isHydrated,
    messages,
    notifyError: feedback.notifyError,
    onStorageError: reportStorageError,
    refreshStorageUsage: images.refreshStorageUsage,
    saveCurrentSettings: settings.saveCurrentSettings,
  });
  const backup = useStudioBackup({
    activeConversationId: conversations.activeConversationId,
    attachedImages: images.attachedImages,
    composerText,
    conversations: conversations.conversations,
    imageAssets: images.imageAssets,
    messages,
    notifyError: feedback.notifyError,
    notifySuccess: feedback.notifySuccess,
    onStorageError: reportStorageError,
    restoreFromStorage,
  });
  const previewImage = computed(() => images.imageById(previewImageId.value));
  const attachedImageIds = computed(() =>
    images.activeAttachments.value.map((image) => image.id),
  );

  function openConversations() {
    isConversationSidebarOpen.value = true;
  }

  function previewImageById(id: string) {
    previewImageId.value = id;
  }

  function closePreview() {
    previewImageId.value = "";
  }

  function openBatchImageOperations() {
    settingsInitialTab.value = "batch";
    settingsInitialBatchPanel.value = "images";
    ui.openSettings();
  }

  function openSettingsDefault() {
    settingsInitialTab.value = "api";
    settingsInitialBatchPanel.value = "images";
    ui.openSettings();
  }

  onMounted(() => {
    void restoreFromStorage();
  });

  watch(composerText, (value) => {
    writeStorage(STORAGE_KEYS.draftComposerText, value);
  });

  const sidebar = proxyRefs({
    activeConversationId: conversations.activeConversationId,
    conversations: conversations.conversations,
    createConversation: conversations.createConversation,
    deleteConversation: conversations.deleteConversation,
    isOpen: isConversationSidebarOpen,
    openSettings: openSettingsDefault,
    selectConversation: conversations.selectConversation,
  });
  const chat = proxyRefs({
    activeAttachments: images.activeAttachments,
    activeConversation: conversations.activeConversation,
    activeEditor: ui.activeEditor,
    activeMessages: conversations.activeMessages,
    activeSizePreset: settings.activeSizePreset,
    applySizePreset: settings.applySizePreset,
    attachImage: images.attachImage,
    background: settings.background,
    backgroundLabel: settings.backgroundLabel,
    backgroundOptions: settings.backgroundOptions,
    canSend: generation.canSend,
    closeAllEditors: ui.closeAllEditors,
    composerText,
    customSizeError: settings.customSizeError,
    formatLabel: settings.formatLabel,
    formatOptions: settings.formatOptions,
    imageById: images.imageById,
    imageHeight: settings.imageHeight,
    imageWidth: settings.imageWidth,
    importImages: images.importImages,
    isEditorExpanded: ui.isEditorExpanded,
    isGenerating: generation.isGenerating,
    isLibraryOpen: ui.isLibraryOpen,
    model: settings.model,
    openConversations,
    openSettings: openSettingsDefault,
    outputFormat: settings.outputFormat,
    previewImage: previewImageById,
    quality: settings.quality,
    qualityLabel: settings.qualityLabel,
    qualityOptions: settings.qualityOptions,
    removeAttachment: images.removeAttachment,
    retryMessage: generation.retryMessage,
    sizeLabel: settings.sizeLabel,
    sizePresets: settings.sizePresets,
    submitMessage: generation.submitMessage,
    toggleEditor: ui.toggleEditor,
  });
  const library = proxyRefs({
    activeConversationId: conversations.activeConversationId,
    attachImage: images.attachImage,
    attachedImageIds,
    deleteImage: images.deleteImage,
    images: images.imageAssets,
    isOpen: ui.isLibraryOpen,
    openBatchOperations: openBatchImageOperations,
    previewImage: previewImageById,
    storageUsage: images.storageUsage,
  });
  const settingsModal = proxyRefs({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    close: ui.closeSettings,
    conversations: conversations.conversations,
    deleteConversations: conversations.deleteConversations,
    deleteImages: images.deleteImages,
    exportBackup: backup.exportBackup,
    images: images.imageAssets,
    importBackup: backup.importBackup,
    initialBatchPanel: settingsInitialBatchPanel,
    initialTab: settingsInitialTab,
    isOpen: ui.isSettingsOpen,
    messages,
    previewImage: previewImageById,
  });
  const preview = proxyRefs({
    close: closePreview,
    image: previewImage,
  });
  const noticeToast = proxyRefs({
    close: feedback.dismissNotice,
    notice: feedback.notice,
  });
  const confirmDialog = proxyRefs({
    cancel: feedback.cancelConfirmDialog,
    confirm: feedback.acceptConfirmDialog,
    dialog: feedback.confirmDialog,
  });

  return {
    chat,
    confirmDialog,
    library,
    noticeToast,
    preview,
    settingsModal,
    sidebar,
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
