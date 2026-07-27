import { computed, onMounted, proxyRefs, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStudioBackup, useStudioRestore } from "../../features/backup";
import { useStudioConversations } from "../../features/conversations";
import { useStudioDrafts } from "../../features/drafts/useStudioDrafts";
import { useStudioFeedback } from "../../features/feedback";
import {
  createDirectImagesClient,
  createLocalCompanionImagesClient,
  type ImageClient,
  useStudioGeneration,
} from "../../features/generation";
import { useStudioImages } from "../../features/images";
import { useStudioSettings } from "../../features/settings";
import { initTrackerStorage } from "../../features/analytics/useAnalyticsTracker";
import { useCompanionStore } from "../../stores/companionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { withNetworkRetry } from "../../services/networkRetry";
import { clonePromptWordbanks } from "../../services/promptWordbanks";
import { createConversationServices } from "../../services/conversations";
import { createMessageServices } from "../../services/messages";
import { createImageAssetServices } from "../../services/imageAssets";
import { createSettingsServices, createConfigServices } from "../../services/settings";
import { createConversationDraftServices } from "../../services/conversationDrafts";
import { createAnalyticsEventServices } from "../../services/analyticsEvents";
import { createBackupServices } from "../../services/backups";
import { createTimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { resolveStorage } from "../../services/storage/resolveStorage";
import { copyText as copyTextToClipboard } from "../../shared/clipboard";
import {
  applyUrlSettings,
  getPromptFromUrlParams,
  hasUrlGenerationParams,
} from "../../services/urlSettings";
import { useAnalyticsStore } from "../../stores/analyticsStore";
import { track } from "../../features/analytics/useAnalyticsTracker";
import { useComposerStore } from "../../stores/composerStore";
import type {
  AnalyticsPromptCapture,
  Message,
  PromptMode,
  PromptRequestSettings,
  PromptWordbankSectionKey,
} from "../../types/studio";

type SettingsTab =
  | "general"
  | "api"
  | "promptMode"
  | "favoritePrompts"
  | "prompt"
  | "backup"
  | "batch"
  | "analytics";
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

  // ─── 阶段二 PR6：装配顺序调整 ───
  // 先取 settingsStore 实例（Pinia 单例，重复调用返回同一实例），拿到 connectionMode /
  // companionUrl / companionAccessKey 的 ref，供 resolveStorage 按 connectionMode 分叉。
  // 必须在 resolveStorage 之前，因为 CompanionStorage 需要这两个 ref 的惰性 getter。
  const settingsStore = useSettingsStore();
  const settingsRefs = storeToRefs(settingsStore);

  // ─── service 工厂全集（唯一装配点，决策 T1 + §6.3） ───
  // 所有 service 共享同一个 storage 实例（resolveStorage），store/feature 通过注入获取。
  // 阶段一恒返回 IndexedDbStorage；阶段二 localCompanion → CompanionStorage；阶段四 isTauriRuntime → NativeStorage。
  // getter 闭包持有 ref，每次 fetch 惰性读取最新值（避免装配顺序耦合）。
  const storage = resolveStorage({
    connectionMode: settingsRefs.connectionMode.value,
    getCompanionUrl: () => settingsRefs.companionUrl.value,
    getCompanionAccessKey: () => settingsRefs.companionAccessKey.value,
  });
  const services = {
    conversations: createConversationServices(storage),
    messages: createMessageServices(storage),
    imageAssets: createImageAssetServices(storage),
    settings: createSettingsServices(storage),
    config: createConfigServices(storage),
    drafts: createConversationDraftServices(storage),
    analyticsEvents: createAnalyticsEventServices(storage),
    backup: createBackupServices(storage),
    timeFieldMigration: createTimeFieldMigrationServices(storage),
  };
  // analytics tracker 是模块级单例，无法通过参数注入，用 init 注入 service。
  initTrackerStorage(services.analyticsEvents);

  const settings = useStudioSettings({
    isHydrated,
    onStorageError: reportStorageError,
    services: { settings: services.settings, config: services.config },
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
  const analytics = useAnalyticsStore();
  const { eventCount: analyticsEventCount } = storeToRefs(analytics);
  // Companion 连接 + 管理状态：共享 Pinia 单例 store，工作台和 /companion 管理页共用。
  // 探活/配对/凭证/日志全收拢在这里，不重复实例化、不重复轮询。
  const companionStore = useCompanionStore();
  const conversations = useStudioConversations({
    services: {
      conversations: services.conversations,
      messages: services.messages,
    },
    clearDraft: clearConversationDraft,
    onStorageError: reportStorageError,
    refreshStorageUsage: refreshImagesStorageUsage,
  });
  const messages = conversations.messages;
  const images = useStudioImages({
    services: { imageAssets: services.imageAssets },
    activeConversationId: conversations.activeConversationId,
    messages,
    onStorageError: reportStorageError,
  });

  // clearConversationDraft 留在 ViewModel 而非 useStudioDrafts：
  // 它被 useStudioConversations 通过 clearDraft 参数消费，又依赖 images/composerState，
  // 搬进 drafts 会构成 drafts ↔ conversations ↔ images 的环。
  function clearConversationDraft() {
    images.attachedImages.value = [];
    composerText.value = "";
    composerState.clearEditSelection();
  }

  // 草稿管理：select/create/delete 会话时的草稿同步、防抖保存、URL 覆盖。
  // analytics 埋点留在 ViewModel 包装层，drafts 不依赖 analytics。
  const drafts = useStudioDrafts({
    draftServices: services.drafts,
    isHydrated,
    composerText,
    editModeEnabled,
    activeEditSourceImageId,
    activeEditMaskImageId,
    activeConversationId: conversations.activeConversationId,
    attachedImages: images.attachedImages,
    imageById: images.imageById,
    activeSizePreset: settings.activeSizePreset,
    imageWidth: settings.imageWidth,
    imageHeight: settings.imageHeight,
    quality: settings.quality,
    background: settings.background,
    outputFormat: settings.outputFormat,
    applySizePreset: settings.applySizePreset,
    applySizeResolution: settings.applySizeResolution,
    currentGenerationParams: settings.currentGenerationParams,
    selectConversation: conversations.selectConversation,
    createConversation: conversations.createConversation,
    deleteConversation: conversations.deleteConversation,
    deleteConversations: conversations.deleteConversations,
    onStorageError: reportStorageError,
  });

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
    getSupportsTransparent: () =>
      settings.providerCapability.value.backgrounds.includes("transparent"),
    getSizeConstraints: () => settings.currentSizeConstraints.value,
  });
  const localCompanionImagesClient = createLocalCompanionImagesClient({
    getCompanionUrl: () => settings.companionUrl.value,
    getAccessKey: () => settings.companionAccessKey.value,
    getModel: () => settings.model.value,
  });
  // provider 不支持 mask（区域编辑）时，强制关闭区域编辑模式，
  // 避免按钮被隐藏后仍停留在「开」状态。
  watch(
    () => settings.providerCapability.value.mask,
    (supportsMask) => {
      if (!supportsMask && editModeEnabled.value) {
        editModeEnabled.value = false;
      }
    },
  );
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
    services: {
      imageAssets: services.imageAssets,
      messages: services.messages,
    },
    supportsEdit: computed(() => settings.providerCapability.value.edit),
    notifyUnsupportedEdit: () =>
      feedback.notifyError(
        "当前模型不支持图生图编辑，请移除参考图，或切换到支持图片编辑的模型。",
      ),
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
    services: {
      conversations: services.conversations,
      messages: services.messages,
      imageAssets: services.imageAssets,
      settings: services.settings,
      config: services.config,
      timeFieldMigration: services.timeFieldMigration,
    },
    companionUrl: settings.companionUrl,
    companionAccessKey: settings.companionAccessKey,
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
    backupServices: services.backup,
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
    analytics.setContext({ imageId: id });
    track("image.preview_opened", undefined, "system");
  }

  function closePreview() {
    previewImageId.value = "";
  }

  function openSettings() {
    isSettingsOpen.value = true;
    track("settings.opened", undefined, "system");
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
        services.settings.save,
        settings.applySettings,
      ).catch(reportStorageError);

      analytics.configure(settings.currentSettings());
      void analytics.refreshEventCount();

      // 草稿初始化时序：必须在 restore + urlSettings + analytics 之后。
      // initDraftsOnMount 内部处理 loadConversationDraft / legacy 迁移 / URL 覆盖。
      await drafts.initDraftsOnMount({
        urlPrompt,
        shouldApplyUrlGenerationParams,
      });
    });
  });

  watch(
    [settings.analyticsEnabled, settings.analyticsPromptCapture],
    () => {
      if (!isHydrated.value) return;
      analytics.configure(settings.currentSettings());
    },
  );

  async function copyText(text: string) {
    try {
      await copyTextToClipboard(text);
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
      drafts.applyGenerationParams(message.generationParams);
    }

    void drafts.saveDraftForCurrentConversation().catch(reportStorageError);
    feedback.notifySuccess("已加载到输入面板。");
  }

  // selectConversationWithDraft 在 drafts 之上包一层 analytics 埋点：
  // setContext + track 必须在 select 前同步触发，drafts 本身不依赖 analytics。
  function selectConversationWithDraft(id: string) {
    analytics.setContext({ conversationId: id, imageId: undefined });
    track("conversation.selected", { conversationId: id }, "system");
    drafts.selectConversationWithDraft(id);
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
    analytics.setContext({ conversationId });
    track("conversation.renamed", { conversationId }, "system");
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
    analytics.setContext({ imageId });
    track("image.renamed", { imageId }, "system");
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

  function setAnalyticsEnabled(value: boolean) {
    settings.analyticsEnabled.value = value;
    persistSettingsChange();
    analytics.configure(settings.currentSettings());
  }

  function setAnalyticsPromptCapture(value: AnalyticsPromptCapture) {
    settings.analyticsPromptCapture.value = value;
    persistSettingsChange();
    analytics.configure(settings.currentSettings());
  }

  async function exportAnalyticsEvents() {
    track("backup.export_requested", { kind: "analytics" }, "system");
    try {
      await analytics.exportEvents();
      track("backup.export_succeeded", { kind: "analytics" }, "system");
      feedback.notifySuccess("行为日志已开始下载。");
    } catch {
      track("backup.export_failed", { kind: "analytics" }, "system");
      feedback.notifyError("导出行为日志失败。");
    }
  }

  async function clearAnalyticsEvents() {
    await analytics.clearEvents();
    feedback.notifySuccess("行为日志已清空。");
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

  // deleteConversationWithDraft / deleteConversationsWithDraft 直接转发给 drafts。
  // deleteConversationsWithDraft 在无激活会话时需清空 composer，由 ViewModel 补一层。
  async function deleteConversationsWithDraft(ids: string[]) {
    await drafts.deleteConversationsWithDraft(ids);
    if (!conversations.activeConversationId.value) {
      clearConversationDraft();
    }
  }

  const sidebar = proxyRefs({
    createConversation: drafts.createConversationWithDraft,
    deleteConversation: drafts.deleteConversationWithDraft,
    openSettings: openSettingsDefault,
    renameConversation,
    selectConversation: selectConversationWithDraft,
  });
  const chatHeader = proxyRefs({
    activeConversation: conversations.activeConversation,
    isLibraryOpen,
    companionStatus: computed(() => ({
      show: settings.connectionMode.value === "localCompanion",
      online: companionStore.companionOnline,
      version: companionStore.companionHealth?.version,
    })),
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
    connectionMode: settings.connectionMode,
    companionUrl: settings.companionUrl,
    companionAccessKey: settings.companionAccessKey,
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
    analyticsEnabled: settings.analyticsEnabled,
    analyticsPromptCapture: settings.analyticsPromptCapture,
    analyticsEventCount,
    setAnalyticsEnabled,
    setAnalyticsPromptCapture,
    exportAnalyticsEvents,
    clearAnalyticsEvents,
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
