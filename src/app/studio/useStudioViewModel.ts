import { computed, onMounted, proxyRefs, ref, watch } from "vue";
import { storeToRefs } from "pinia";
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
import { withNetworkRetry } from "../../services/networkRetry";
import { clonePromptWordbanks } from "../../services/promptWordbanks";
import {
  deleteConversationDraft,
  deleteConversationDrafts,
  loadConversationDraft,
  saveConversationDraft,
} from "../../services/conversationDrafts";
import { saveSettings } from "../../services/settings";
import {
  applyUrlSettings,
  getPromptFromUrlParams,
  hasUrlGenerationParams,
} from "../../services/urlSettings";
import { readJsonStorage, readStorage } from "../../shared/localStorage";
import { useComposerStore } from "../../stores/composerStore";
import type {
  ConversationDraft,
  GenerationParams,
  Message,
  PromptMode,
  PromptRequestSettings,
  PromptWordbankSectionKey,
} from "../../types/studio";

const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
  draftAttachments: "gpt-image-studio:draft-attachments",
} as const;

type SettingsTab =
  | "general"
  | "api"
  | "promptMode"
  | "favoritePrompts"
  | "prompt"
  | "backup"
  | "batch";
type BatchPanel = "images" | "conversations";
type RenameDialogState = {
  isOpen: boolean;
  conversationId: string;
  initialTitle: string;
};
type RenameImageDialogState = {
  isOpen: boolean;
  imageId: string;
  initialName: string;
};

export function useStudioViewModel() {
  const isHydrated = ref(false);
  const settings = useStudioSettings({
    isHydrated,
    onStorageError: reportStorageError,
  });
  const composerState = useComposerStore();
  const {
    activeEditMaskImageId,
    activeEditSourceImageId,
    composerText,
    editModeEnabled,
    isLibraryOpen,
  } = storeToRefs(composerState);
  const isSettingsOpen = ref(false);
  const legacyComposerText = readStorage(STORAGE_KEYS.draftComposerText, "");
  const legacyAttachedImageIds = readJsonStorage<string[]>(STORAGE_KEYS.draftAttachments, []);
  let isApplyingDraft = false;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSwitchQueue = Promise.resolve();

  const previewImageId = ref("");
  const settingsInitialTab = ref<SettingsTab | undefined>(undefined);
  const settingsInitialBatchPanel = ref<BatchPanel>("images");
  const renameDialog = ref<RenameDialogState>({
    isOpen: false,
    conversationId: "",
    initialTitle: "",
  });
  const renameImageDialog = ref<RenameImageDialogState>({
    isOpen: false,
    imageId: "",
    initialName: "",
  });
  const feedback = useStudioFeedback();
  const conversations = useStudioConversations({
    clearDraft: clearConversationDraft,
    onStorageError: reportStorageError,
    refreshStorageUsage: refreshImagesStorageUsage,
  });
  const messages = conversations.messages;
  const images = useStudioImages({
    activeConversationId: conversations.activeConversationId,
    messages,
    onStorageError: reportStorageError,
  });

  function clearConversationDraft() {
    images.attachedImages.value = [];
    composerText.value = "";
    composerState.clearEditSelection();
  }

  function refreshImagesStorageUsage() {
    return images.refreshStorageUsage();
  }

  const directImagesClient = createDirectImagesClient({
    getApiBaseUrl: () => settings.apiBaseUrl.value,
    getApiBaseUrlMode: () => settings.apiBaseUrlMode.value,
    getApiMode: () => settings.apiMode.value,
    getApiKey: () => settings.apiKey.value,
    getModel: () => settings.model.value,
    getStreamImages: () => settings.streamImages.value,
    getStreamPartialImages: () => settings.streamPartialImages.value,
  });
  const localCompanionImagesClient = createLocalCompanionImagesClient({
    getCompanionUrl: () => settings.companionUrl.value,
    getSessionToken: () => settings.companionSessionToken.value,
    getModel: () => settings.model.value,
  });
  const imageClient: ImageClient = {
    generate(input) {
      if (
        settings.connectionMode.value === "localCompanion" &&
        settings.apiMode.value !== "images"
      ) {
        throw new Error("本地 Companion 当前仅支持 Images API。");
      }
      const fn = () => settings.connectionMode.value === "localCompanion"
        ? localCompanionImagesClient.generate(input)
        : directImagesClient.generate(input);
      return withNetworkRetry(
        fn,
        () => settings.autoRetryOnNetworkError.value,
        input.onNetworkRetry,
      );
    },
    edit(input) {
      if (
        settings.connectionMode.value === "localCompanion" &&
        settings.apiMode.value !== "images"
      ) {
        throw new Error("本地 Companion 当前仅支持 Images API。");
      }
      const fn = () => settings.connectionMode.value === "localCompanion"
        ? localCompanionImagesClient.edit(input)
        : directImagesClient.edit(input);
      return withNetworkRetry(
        fn,
        () => settings.autoRetryOnNetworkError.value,
        input.onNetworkRetry,
      );
    },
  };

  const generation = useStudioGeneration({
    activeConversationId: conversations.activeConversationId,
    activeConversation: conversations.activeConversation,
    attachedImages: images.attachedImages,
    activeEditMaskImageId,
    activeEditSourceImageId,
    composerText,
    createConversationRecord: conversations.createConversationRecord,
    currentGenerationParams: settings.currentGenerationParams,
    currentPromptRequestSettings,
    customSizeError: settings.customSizeError,
    imageAssets: images.imageAssets,
    imageById: images.imageById,
    imageClient,
    messages,
    onApiConfigurationError: openApiSettingsFromGenerationError,
    onStorageError: reportStorageError,
    conversationExists: (id: string) =>
      conversations.conversations.value.some((item) => item.id === id),
    persistConversation: conversations.persistConversation,
    refreshStorageUsage: images.refreshStorageUsage,
    updateConversationSummary: conversations.updateConversationSummary,
  });

  function currentPromptRequestSettings(): PromptRequestSettings {
    return {
      promptMode: settings.promptMode.value,
      promptWordbanks: clonePromptWordbanks(settings.promptWordbanks.value),
      promptRewriteGuardEnabled: settings.promptRewriteGuardEnabled.value,
      promptRewriteGuardText: settings.promptRewriteGuardText.value,
    };
  }
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
  const previewMaskUrl = computed(() => {
    if (previewImageId.value !== activeEditSourceImageId.value) return undefined;
    const maskAsset = images.imageById(activeEditMaskImageId.value);
    return maskAsset?.previewUrl;
  });
  const attachedImageIds = computed(() =>
    images.activeAttachments.value.map((image) => image.id),
  );

  function previewImageById(id: string) {
    previewImageId.value = id;
  }

  function closePreview() {
    previewImageId.value = "";
  }

  function openSettings() {
    isSettingsOpen.value = true;
  }

  function closeSettings() {
    isSettingsOpen.value = false;
  }

  function openBatchImageOperations() {
    settingsInitialTab.value = "batch";
    settingsInitialBatchPanel.value = "images";
    openSettings();
  }

  function openSettingsDefault() {
    settingsInitialTab.value = undefined;
    settingsInitialBatchPanel.value = "images";
    openSettings();
  }

  function openFavoritePromptSettings() {
    settingsInitialTab.value = "favoritePrompts";
    settingsInitialBatchPanel.value = "images";
    openSettings();
  }

  function openApiSettingsFromGenerationError() {
    settingsInitialTab.value = "api";
    settingsInitialBatchPanel.value = "images";
    openSettings();
    feedback.notifyError("图片接口认证失败，请检查 API key 和接口地址。");
  }

  onMounted(() => {
    void restoreFromStorage().then(async () => {
      const urlSearchParams = new URLSearchParams(window.location.search);
      const urlPrompt = getPromptFromUrlParams(urlSearchParams);
      const shouldApplyUrlGenerationParams = hasUrlGenerationParams(urlSearchParams);

      await applyUrlSettings(
        settings.currentSettings(),
        saveSettings,
        settings.applySettings,
      ).catch(reportStorageError);

      const activeConversationId = conversations.activeConversationId.value;
      if (!activeConversationId) return;

      const draft = await loadConversationDraft(activeConversationId).catch(reportStorageError);
      if (draft) {
        applyConversationDraft(draft);
        applyUrlDraftOverrides(urlPrompt, shouldApplyUrlGenerationParams);
        return;
      }

      if (legacyComposerText || legacyAttachedImageIds.length) {
        applyConversationDraft(createLegacyDraft(activeConversationId));
      } else {
        applyConversationDraft(createDefaultDraft(activeConversationId));
      }
      applyUrlDraftOverrides(urlPrompt, shouldApplyUrlGenerationParams);
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
      editModeEnabled,
      activeEditSourceImageId,
      activeEditMaskImageId,
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
      editModeEnabled: false,
      generationParams: settings.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function createLegacyDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: legacyComposerText,
      attachedImageIds: legacyAttachedImageIds,
      editModeEnabled: false,
      generationParams: settings.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function applyConversationDraft(draft: ConversationDraft) {
    isApplyingDraft = true;
    composerText.value = draft.composerText;
    images.attachedImages.value = draft.attachedImageIds.filter((id) => Boolean(images.imageById(id)));
    editModeEnabled.value = draft.editModeEnabled;
    activeEditSourceImageId.value = draft.editSourceImageId ?? "";
    activeEditMaskImageId.value = draft.editMaskImageId ?? "";
    applyGenerationParams(draft.generationParams);
    isApplyingDraft = false;
  }

  function applyGenerationParams(params: GenerationParams) {
    settings.applySizeResolution(params.resolution);
    settings.applySizePreset(params.size);
    settings.imageWidth.value = params.width;
    settings.imageHeight.value = params.height;
    settings.quality.value = params.quality;
    settings.background.value = params.background;
    settings.outputFormat.value = params.outputFormat;
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyTextWithTextarea(text);
      }
      feedback.notifySuccess("文本已复制。");
    } catch (error) {
      feedback.notifyError("复制失败，请手动选择文本复制。");
      reportStorageError(error);
    }
  }

  function loadMessageConfig(message: Message) {
    composerText.value = message.content;
    images.attachedImages.value = message.referencedImageIds.filter((id) =>
      Boolean(images.imageById(id)),
    );
    composerState.clearEditSelection();
    editModeEnabled.value = false;

    if (message.generationParams) {
      applyGenerationParams(message.generationParams);
    }

    const conversationId = conversations.activeConversationId.value;
    if (conversationId) {
      void saveConversationDraft(currentConversationDraft(conversationId)).catch(
        reportStorageError,
      );
    }
    feedback.notifySuccess("已加载到输入面板。");
  }

  function applyUrlDraftOverrides(
    prompt: string | undefined,
    shouldApplyGenerationParams: boolean,
  ) {
    if (prompt === undefined && !shouldApplyGenerationParams) return;

    isApplyingDraft = true;
    if (prompt !== undefined) composerText.value = prompt;
    if (shouldApplyGenerationParams) {
      applyGenerationParams(settings.currentGenerationParams());
    }
    isApplyingDraft = false;
    void saveActiveDraft().catch(reportStorageError);
  }

  function currentConversationDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: composerText.value,
      attachedImageIds: [...images.attachedImages.value],
      editModeEnabled: editModeEnabled.value,
      editSourceImageId: activeEditSourceImageId.value || undefined,
      editMaskImageId: activeEditMaskImageId.value || undefined,
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

  async function renameConversation(id: string) {
    const conversation = conversations.conversations.value.find((item) => item.id === id);
    if (!conversation) return;
    renameDialog.value = {
      isOpen: true,
      conversationId: id,
      initialTitle: conversation.title,
    };
  }

  function cancelRenameConversation() {
    renameDialog.value = {
      isOpen: false,
      conversationId: "",
      initialTitle: "",
    };
  }

  async function confirmRenameConversation(nextTitle: string) {
    const conversationId = renameDialog.value.conversationId;
    const previousTitle = renameDialog.value.initialTitle;
    if (!conversationId) return;

    cancelRenameConversation();
    if (nextTitle === previousTitle) return;
    await conversations.renameConversation(conversationId, nextTitle);
    feedback.notifySuccess("会话已重命名。");
  }

  function requestRenameImage(id: string) {
    const image = images.imageById(id);
    if (!image) return;
    renameImageDialog.value = {
      isOpen: true,
      imageId: id,
      initialName: image.name,
    };
  }

  function cancelRenameImage() {
    renameImageDialog.value = {
      isOpen: false,
      imageId: "",
      initialName: "",
    };
  }

  async function confirmRenameImage(nextName: string) {
    const imageId = renameImageDialog.value.imageId;
    const previousName = renameImageDialog.value.initialName;
    if (!imageId) return;

    cancelRenameImage();
    if (nextName === previousName) return;
    await images.renameImage(imageId, nextName);
    feedback.notifySuccess("图片已重命名。");
  }

  function persistSettingsChange() {
    void settings.saveCurrentSettings().catch(reportStorageError);
  }

  function setPromptRewriteGuardEnabled(value: boolean) {
    settings.promptRewriteGuardEnabled.value = value;
    persistSettingsChange();
  }

  function setPromptMode(value: PromptMode) {
    settings.promptMode.value = value;
    persistSettingsChange();
  }

  function savePromptWordbank(section: PromptWordbankSectionKey, terms: string[]) {
    settings.savePromptWordbank(section, terms);
    persistSettingsChange();
  }

  function restoreDefaultPromptWordbank(section: PromptWordbankSectionKey) {
    settings.restoreDefaultPromptWordbank(section);
    persistSettingsChange();
  }

  function savePromptRewriteGuardText(text: string) {
    settings.savePromptRewriteGuardText(text);
    persistSettingsChange();
  }

  function restoreDefaultPromptRewriteGuardText() {
    settings.restoreDefaultPromptRewriteGuardText();
    persistSettingsChange();
  }

  function restorePromptRewriteGuardHistoryItem(id: string) {
    settings.restorePromptRewriteGuardHistoryItem(id);
    persistSettingsChange();
  }

  function deletePromptRewriteGuardHistoryItem(id: string) {
    settings.deletePromptRewriteGuardHistoryItem(id);
    persistSettingsChange();
  }

  function addFavoritePrompt(input: { title?: string; text?: string }) {
    const didAdd = settings.addFavoritePrompt(input);
    if (didAdd) persistSettingsChange();
    return didAdd;
  }

  function updateFavoritePrompt(
    id: string,
    input: { title?: string; text?: string },
  ) {
    const didUpdate = settings.updateFavoritePrompt(id, input);
    if (didUpdate) persistSettingsChange();
    return didUpdate;
  }

  function deleteFavoritePrompt(id: string) {
    settings.deleteFavoritePrompt(id);
    persistSettingsChange();
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
    createConversation: createConversationWithDraft,
    deleteConversation: deleteConversationWithDraft,
    openSettings: openSettingsDefault,
    renameConversation,
    selectConversation: selectConversationWithDraft,
  });
  const chatHeader = proxyRefs({
    activeConversation: conversations.activeConversation,
    isLibraryOpen,
  });
  const chatMessages = proxyRefs({
    activeAttachmentIds: attachedImageIds,
    activeMessages: conversations.activeMessages,
  });
  const chatActions = {
    closeAllEditors: composerState.closeAllEditors,
    copyText,
    generateAnother: generation.generateAnother,
    loadMessageConfig,
    openConversations: composerState.openConversations,
    openSettings: openSettingsDefault,
    openFavoritePromptSettings,
    previewImage: previewImageById,
    removeAttachment: (id: string) => {
      if (
        id === activeEditSourceImageId.value ||
        id === activeEditMaskImageId.value
      ) {
        const sourceId = activeEditSourceImageId.value;
        const maskId = activeEditMaskImageId.value;
        if (sourceId) {
          images.removeAttachment(sourceId);
        }
        if (maskId && maskId !== sourceId) {
          images.removeAttachment(maskId);
          images.clearTransientMask(maskId);
        }
        composerState.clearEditSelection();
        return;
      }

      images.removeAttachment(id);
    },
    retryMessage: generation.retryMessage,
    refreshImage: generation.refreshGeneratedImage,
    setEditModeEnabled: (value: boolean) => {
      if (!value) {
        if (activeEditMaskImageId.value) {
          images.clearTransientMask(activeEditMaskImageId.value);
        }
      }
      composerState.setEditModeEnabled(value);
    },
    setLibraryOpen: composerState.setLibraryOpen,
    applyEditSelection: (sourceImageId: string, maskImageId: string) => {
      const previousMaskId = activeEditMaskImageId.value;
      if (previousMaskId && previousMaskId !== maskImageId) {
        images.clearTransientMask(previousMaskId);
      }
      composerState.applyEditSelection(sourceImageId, maskImageId);
      images.attachedImages.value = [sourceImageId, maskImageId];
    },
    clearEditSelection: composerState.clearEditSelection,
    toggleEditor: composerState.toggleEditor,
  };
  const chat = {
    actions: chatActions,
    header: chatHeader,
    messages: chatMessages,
  };
  const library = proxyRefs({
    openBatchOperations: openBatchImageOperations,
    previewImage: previewImageById,
    renameImage: requestRenameImage,
  });
  const settingsModal = proxyRefs({
    autoRetryOnNetworkError: settings.autoRetryOnNetworkError,
    apiMode: settings.apiMode,
    apiBaseUrl: settings.apiBaseUrl,
    apiBaseUrlMode: settings.apiBaseUrlMode,
    apiKey: settings.apiKey,
    companionPaired: settings.companionPaired,
    companionSessionToken: settings.companionSessionToken,
    companionUrl: settings.companionUrl,
    connectionMode: settings.connectionMode,
    favoritePrompts: settings.favoritePrompts,
    promptMode: settings.promptMode,
    promptWordbanks: settings.promptWordbanks,
    promptRewriteGuardEnabled: settings.promptRewriteGuardEnabled,
    promptRewriteGuardHistory: settings.promptRewriteGuardHistory,
    promptRewriteGuardText: settings.promptRewriteGuardText,
    close: closeSettings,
    conversations: conversations.conversations,
    deleteConversations: deleteConversationsWithDraft,
    deleteImages: images.deleteImages,
    exportBackup: backup.exportBackup,
    images: images.imageAssets,
    importBackup: backup.importBackup,
    initialBatchPanel: settingsInitialBatchPanel,
    initialTab: settingsInitialTab,
    isOpen: isSettingsOpen,
    messages,
    model: settings.model,
    previewImage: previewImageById,
    deletePromptRewriteGuardHistoryItem,
    restoreDefaultPromptRewriteGuardText,
    restorePromptRewriteGuardHistoryItem,
    savePromptRewriteGuardText,
    savePromptWordbank,
    setPromptMode,
    setPromptRewriteGuardEnabled,
    streamImages: settings.streamImages,
    streamPartialImages: settings.streamPartialImages,
    addFavoritePrompt,
    updateFavoritePrompt,
    deleteFavoritePrompt,
    restoreDefaultPromptWordbank,
  });
  const preview = proxyRefs({
    close: closePreview,
    editImage: (id: string) => {
      closePreview();
      composerState.selectingEditImageId = id;
    },
    image: previewImage,
    maskUrl: previewMaskUrl,
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
  const renameModal = proxyRefs({
    cancel: cancelRenameConversation,
    confirm: confirmRenameConversation,
    confirmLabel: "保存名称",
    description: "重命名后，会话标题不会再被新消息自动覆盖。",
    initialValue: computed(() => renameDialog.value.initialTitle),
    isOpen: computed(() => renameDialog.value.isOpen),
    title: "重命名会话",
  });
  const renameImageModal = proxyRefs({
    cancel: cancelRenameImage,
    confirm: confirmRenameImage,
    confirmLabel: "保存名称",
    description: "修改后会同步用于图片库展示和下载文件名。",
    initialValue: computed(() => renameImageDialog.value.initialName),
    isOpen: computed(() => renameImageDialog.value.isOpen),
    title: "重命名图片",
  });

  return {
    chat,
    confirmDialog,
    library,
    noticeToast,
    preview,
    renameImageModal,
    renameModal,
    settingsModal,
    sidebar,
  };
}

function reportStorageError(error: unknown) {
  console.error("Failed to access local studio storage.", error);
}

function copyTextWithTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
