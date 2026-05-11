import { computed, onMounted, proxyRefs, ref, watch } from "vue";
import { useStudioBackup, useStudioRestore } from "../../features/backup";
import { useStudioConversations } from "../../features/conversations";
import { useStudioFeedback } from "../../features/feedback";
import {
  createDirectImagesClient,
  createLocalCompanionImagesClient,
  type ImageClient,
  useStudioGeneration,
} from "../../features/generation";
import { useStudioImages } from "../../features/images";
import { useStudioSettings } from "../../features/settings";
import {
  deleteConversationDraft,
  deleteConversationDrafts,
  loadConversationDraft,
  saveConversationDraft,
} from "../../services/conversationDrafts";
import { readJsonStorage, readStorage } from "../../shared/localStorage";
import { useStudioUiState } from "./useStudioUiState";
import type { ConversationDraft, GenerationParams, Message } from "../../types/studio";

const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
  draftAttachments: "gpt-image-studio:draft-attachments",
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
  const composerText = ref("");
  const legacyComposerText = readStorage(STORAGE_KEYS.draftComposerText, "");
  const legacyAttachedImageIds = readJsonStorage<string[]>(STORAGE_KEYS.draftAttachments, []);
  let isApplyingDraft = false;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSwitchQueue = Promise.resolve();

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

  const directImagesClient = createDirectImagesClient({
    getApiBaseUrl: () => settings.apiBaseUrl.value,
    getApiKey: () => settings.apiKey.value,
    getModel: () => settings.model.value,
  });
  const localCompanionImagesClient = createLocalCompanionImagesClient();
  const imageClient: ImageClient = {
    generate(input) {
      if (settings.connectionMode.value === "localCompanion") {
        return localCompanionImagesClient.generate(input);
      }
      return directImagesClient.generate(input);
    },
    edit(input) {
      if (settings.connectionMode.value === "localCompanion") {
        return localCompanionImagesClient.edit(input);
      }
      return directImagesClient.edit(input);
    },
  };

  const generation = useStudioGeneration({
    activeConversationId: conversations.activeConversationId,
    activeConversation: conversations.activeConversation,
    attachedImages: images.attachedImages,
    composerText,
    createConversationRecord: conversations.createConversationRecord,
    currentGenerationParams: settings.currentGenerationParams,
    customSizeError: settings.customSizeError,
    imageAssets: images.imageAssets,
    imageById: images.imageById,
    imageClient,
    messages,
    onStorageError: reportStorageError,
    conversationExists: (id: string) =>
      conversations.conversations.value.some((item) => item.id === id),
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
    void restoreFromStorage().then(async () => {
      const activeConversationId = conversations.activeConversationId.value;
      if (!activeConversationId) return;

      const draft = await loadConversationDraft(activeConversationId).catch(reportStorageError);
      if (draft) {
        applyConversationDraft(draft);
        return;
      }

      if (legacyComposerText || legacyAttachedImageIds.length) {
        applyConversationDraft(createLegacyDraft(activeConversationId));
      } else {
        applyConversationDraft(createDefaultDraft(activeConversationId));
      }
    });
  });

  watch(
    [
      composerText,
      images.attachedImages,
      settings.activeSizePreset,
      settings.imageWidth,
      settings.imageHeight,
      settings.quality,
      settings.background,
      settings.outputFormat,
      conversations.activeConversationId,
    ],
    () => {
      if (!isHydrated.value || isApplyingDraft) return;
      scheduleSaveActiveDraft();
    },
    { deep: true },
  );

  function createDefaultDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: "",
      attachedImageIds: [],
      generationParams: settings.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function createLegacyDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: legacyComposerText,
      attachedImageIds: legacyAttachedImageIds,
      generationParams: settings.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function applyConversationDraft(draft: ConversationDraft) {
    isApplyingDraft = true;
    composerText.value = draft.composerText;
    images.attachedImages.value = draft.attachedImageIds.filter((id) => Boolean(images.imageById(id)));
    applyGenerationParams(draft.generationParams);
    isApplyingDraft = false;
  }

  function applyGenerationParams(params: GenerationParams) {
    settings.applySizePreset(params.size);
    settings.imageWidth.value = params.width;
    settings.imageHeight.value = params.height;
    settings.quality.value = params.quality;
    settings.background.value = params.background;
    settings.outputFormat.value = params.outputFormat;
  }

  function currentConversationDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: composerText.value,
      attachedImageIds: [...images.attachedImages.value],
      generationParams: settings.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function scheduleSaveActiveDraft() {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
    }
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      void saveActiveDraft();
    }, 250);
  }

  async function saveActiveDraft() {
    const conversationId = conversations.activeConversationId.value;
    if (!conversationId) return;

    const draft = currentConversationDraft(conversationId);
    await saveConversationDraft(draft).catch(reportStorageError);
  }

  function selectConversationWithDraft(id: string) {
    draftSwitchQueue = draftSwitchQueue
      .catch(reportStorageError)
      .then(async () => {
        await saveActiveDraft();
        conversations.selectConversation(id);
        const nextDraft = await loadConversationDraft(id).catch(reportStorageError);
        if (nextDraft) {
          applyConversationDraft(nextDraft);
        } else {
          applyConversationDraft(createDefaultDraft(id));
        }
      });
  }

  async function createConversationWithDraft() {
    await saveActiveDraft();
    await conversations.createConversation();
    const id = conversations.activeConversationId.value;
    if (!id) return;
    applyConversationDraft(createDefaultDraft(id));
    await saveConversationDraft(currentConversationDraft(id)).catch(reportStorageError);
  }

  async function deleteConversationWithDraft(id: string) {
    await conversations.deleteConversation(id);
    await deleteConversationDraft(id).catch(reportStorageError);

    const activeId = conversations.activeConversationId.value;
    if (!activeId) return;
    const draft = await loadConversationDraft(activeId).catch(reportStorageError);
    if (draft) {
      applyConversationDraft(draft);
    } else {
      applyConversationDraft(createDefaultDraft(activeId));
    }
  }

  async function deleteConversationsWithDraft(ids: string[]) {
    await conversations.deleteConversations(ids);
    await deleteConversationDrafts(ids).catch(reportStorageError);

    const activeId = conversations.activeConversationId.value;
    if (!activeId) {
      clearConversationDraft();
      return;
    }

    const draft = await loadConversationDraft(activeId).catch(reportStorageError);
    if (draft) {
      applyConversationDraft(draft);
    } else {
      applyConversationDraft(createDefaultDraft(activeId));
    }
  }

  const sidebar = proxyRefs({
    activeConversationId: conversations.activeConversationId,
    conversations: conversations.conversations,
    createConversation: createConversationWithDraft,
    deleteConversation: deleteConversationWithDraft,
    isOpen: isConversationSidebarOpen,
    openSettings: openSettingsDefault,
    pendingJobCountByConversation: generation.pendingJobCountByConversation,
    selectConversation: selectConversationWithDraft,
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
    pendingJobCount: generation.pendingJobCount,
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
    connectionMode: settings.connectionMode,
    close: ui.closeSettings,
    conversations: conversations.conversations,
    deleteConversations: deleteConversationsWithDraft,
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

function reportStorageError(error: unknown) {
  console.error("Failed to access local studio storage.", error);
}
