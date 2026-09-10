import { computed, onMounted, onUnmounted, proxyRefs, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useStudioBackup, useStudioRestore } from "../../features/backup";
import { useStudioConversations } from "../../features/conversations";
import { useStudioDrafts } from "../../features/drafts/useStudioDrafts";
import { useStudioFeedback } from "../../features/feedback";
import { useFeedbackStore } from "../../stores/feedbackStore";
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
import { createStorageUsageServices } from "../../services/storageUsage";
import { createTimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { resolveStorage } from "../../services/storage/resolveStorage";
import { copyText as copyTextToClipboard } from "../../shared/clipboard";
import {
  applyUrlSettings,
  getPromptFromUrlParams,
  hasUrlGenerationParams,
} from "../../services/urlSettings";
import {
  readConversationIdFromUrl,
  writeConversationIdToUrl,
} from "../../services/conversationUrl";
import {
  notifyHostActiveConversationChanged,
  notifyHostConversationsChanged,
  notifyHostSettingsClosed,
  setHostActions,
} from "../../services/embeddedBridge";
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
import { CONNECTION_MODE_SWITCHED_KEY } from "../../shared/constants";

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
    storageUsage: createStorageUsageServices(storage),
    timeFieldMigration: createTimeFieldMigrationServices(storage),
  };
  // analytics tracker 是模块级单例，无法通过参数注入，用 init 注入 service。
  initTrackerStorage(services.analyticsEvents);

  const settings = useStudioSettings({
    isHydrated,
    onStorageError: reportStorageError,
    services: { settings: services.settings },
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
  const { eventCount: analyticsEventCount, analyticsInsights: analyticsInsightsRef } =
    storeToRefs(analytics);
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
    services: {
      imageAssets: services.imageAssets,
      storageUsage: services.storageUsage,
    },
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
    ensureAssetsLoaded: images.ensureAssetsLoaded,
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
  // 注意：connectionMode 切换的重建逻辑已移至 App.vue（组件级 :key 重建，替代
  // 整页 window.location.reload）。App.vue 监听 settingsStore.connectionMode，
  // 切换时先持久化再改 appKey 触发 <StudioShell> 卸载重建，本函数会重新执行
  // resolveStorage() 按新模式装配 storage。sessionStorage 标记也由 App.vue 写入，
  // 下方的 onMounted 读它显示切换成功提示。
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
  // 分页状态整体重置（备份导入后 restore 重跑的前置）：两个 store 的
  // 列表/窗口/游标一起清（PR-c）。
  function resetStudioPagination() {
    conversations.resetPagination();
    images.resetPagination();
  }
  const { restoreFromStorage } = useStudioRestore({
    services: {
      conversations: services.conversations,
      messages: services.messages,
      imageAssets: services.imageAssets,
      settings: services.settings,
      timeFieldMigration: services.timeFieldMigration,
    },
    companionUrl: settings.companionUrl,
    companionAccessKey: settings.companionAccessKey,
    isEmbedded: settings.isEmbedded,
    activeConversationId: conversations.activeConversationId,
    applySettings: settings.applySettings,
    attachedImages: images.attachedImages,
    ensureConversationAssets: images.ensureConversationAssets,
    isHydrated,
    loadAssetsFirstPage: images.loadAssetsFirstPage,
    loadConversationMessages: conversations.loadConversationMessages,
    loadConversationsFirstPage: conversations.loadConversationsFirstPage,
    notifyError: feedback.notifyError,
    onStorageError: reportStorageError,
    refreshStorageUsage: images.refreshStorageUsage,
    resetPagination: resetStudioPagination,
    saveCurrentSettings: settings.saveCurrentSettings,
  });
  const backup = useStudioBackup({
    backupServices: services.backup,
    activeConversationId: conversations.activeConversationId,
    attachedImages: images.attachedImages,
    composerText,
    notifyError: feedback.notifyError,
    notifySuccess: feedback.notifySuccess,
    onStorageError: reportStorageError,
    resetPagination: resetStudioPagination,
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
    // 嵌入态通知宿主把 URL 从 /settings 清回会话态——否则 URL 停在 settings 后
    // 再次点击「设置」菜单（同 URL）不触发 watch、设置弹窗无法重新打开。
    notifyHostSettingsClosed();
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
    // popstate 注册放在 onMounted 同步部分（非 .then 内）：hydration 走 catch
    // 分支时 .then 不执行，但浏览器前进/后退此时仍需可用。
    window.addEventListener("popstate", onPopState);
    // 注入宿主 postMessage 指令桥接（阶段三 PR7 §2.3 + PR8 §2.3 多操作）。
    // 嵌入态下宿主发 select/create/delete/rename 消息时，main.ts 的监听器分发到此。
    // 通知宿主的时机：
    // - create/delete 完成后发 conversations-changed（列表内容变了，宿主刷新）；
    // - rename 只负责打开 RenameDialog，真正的通知在 confirmRenameConversation
    //   确认后发出——此处发的话宿主刷新看到的还是旧标题；
    // - 发消息触发自动标题更新（未手动重命名的会话）也会改列表内容，通知在
    //   generationStore.submitMessage 落库后补发；
    // - select 不发 conversations-changed（列表内容没变）；激活态变化由下方
    //   watch 统一发 active-conversation-changed（pushState 不触发 popstate，
    //   宿主无法靠监听地址栏感知，必须显式通知）。
    // 独立态下监听器不响应（__POWERED_BY_QIANKUN__ 守卫），注入也无副作用；
    // 两个 notify 在独立态都是 no-op。
    setHostActions({
      select: switchToConversationIfValid,
      create: async () => {
        await drafts.createConversationWithDraft();
        notifyHostConversationsChanged();
      },
      delete: async (id: string) => {
        await drafts.deleteConversationWithDraft(id);
        notifyHostConversationsChanged();
      },
      rename: (id: string) => {
        void renameConversation(id);
      },
      openSettings: () => {
        openSettingsDefault();
      },
    });

    void restoreFromStorage().then(async () => {
      const urlSearchParams = new URLSearchParams(window.location.search);
      const urlPrompt = getPromptFromUrlParams(urlSearchParams);
      const shouldApplyUrlGenerationParams = hasUrlGenerationParams(urlSearchParams);

      await applyUrlSettings(
        settings.currentSettings(),
        services.settings.save,
        settings.applySettings,
      ).catch(reportStorageError);

      // provider 回流排序保证（阶段二 PR7 后暴露的时序竞争）：
      // setup 期 companionStore 的 immediate watch 就发出了 /auth/status 探测，
      // 它比 hydrate 快时，applyProviderInfo 先落地、随后被 applySettings 用 settings
      // 记录里的旧 model 顶回去（记录又持久化旧值，永不自愈），页面一直显示切换前的
      // 模型。这里在 hydrate + urlSettings 之后用已拿到的 status 重放一次回流，确保
      // 「先恢复记录值、后覆盖回流值」的顺序成立；status 仍在途也没关系，在途的
      // checkStatus 完成时会自然应用（已在 applySettings 之后）。
      if (settings.connectionMode.value === "localCompanion") {
        settings.applyProviderInfo(companionStore.companionAuthStatus);
      }

      analytics.configure(settings.currentSettings());
      void analytics.refreshEventCount();

      // 草稿初始化时序：必须在 restore + urlSettings + analytics 之后。
      // initDraftsOnMount 内部处理 loadConversationDraft / legacy 迁移 / URL 覆盖。
      await drafts.initDraftsOnMount({
        urlPrompt,
        shouldApplyUrlGenerationParams,
      });

      // 切换连接模式 reload 后的「切换成功」提示：reload 前由 connectionMode
      // watch 写入 sessionStorage 标记，这里读到后按当前模式显示成功文案并清除标记。
      // 放在 hydrate 全流程末尾，避免被后续初始化覆盖或抢焦点。
      try {
        const switched = sessionStorage.getItem(CONNECTION_MODE_SWITCHED_KEY);
        if (switched) {
          sessionStorage.removeItem(CONNECTION_MODE_SWITCHED_KEY);
          const modeLabel =
            switched === "localCompanion" ? "本地 Companion" : "浏览器直连";
          feedback.notifySuccess(`已切换到「${modeLabel}」模式。`);
        }
      } catch {
        // sessionStorage 不可用时静默降级。
      }
    });
  });

  onUnmounted(() => {
    window.removeEventListener("popstate", onPopState);
    setHostActions(null);
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
    // PR-c：不按 imageById 过滤（图片可能在窗口外/仍在加载），id 保留 + 按需补加载。
    images.attachedImages.value = [...message.referencedImageIds];
    void images.ensureAssetsLoaded(message.referencedImageIds).catch(reportStorageError);
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
    // 主动切换进历史栈（阶段三 PR7 §2.2/§3.4 主动切换）。
    // push 去重比较 URL 当前值（非激活 id）：popstate 恢复触发的切换，浏览器
    // 已更新地址栏到目标值，此时 URL === id 不会再 push；否则按一次后退就压
    // 一条新记录、"前进"永远失效。watch 兜底也会同步，但那是 replace 不进栈。
    //
    // 嵌入态（qiankun）跳过：URL 归宿主所有——宿主用 path 参数承载会话 id
    // （/studio/workspace/<id>），子应用写 ?c 会覆盖宿主 query（如页签合并
    // 用的 pageKey），且 pushState/replaceState 经 single-spa 合成 popstate
    // 会干扰宿主流路由。嵌入态的激活同步走 notifyHostActiveConversationChanged。
    if (!window.__POWERED_BY_QIANKUN__ && readConversationIdFromUrl() !== id) {
      writeConversationIdToUrl(id, "push");
    }
  }

  // ─── 当前对话 ↔ URL 双向同步（阶段三 PR7 §2.2/§3.4） ───

  // 消息窗口 + 会话图片的惰性加载（server 模式分页 PR-c）：
  // 单点覆盖所有激活路径（选择/新建/删除回落/popstate/宿主消息/restore 初始），
  // store 内部幂等去重（窗口已是该会话 / ensure 在飞去重），重复触发不重复拉取。
  watch(
    conversations.activeConversationId,
    (id) => {
      void conversations.loadConversationMessages(id).catch(reportStorageError);
      void images.ensureConversationAssets(id).catch(reportStorageError);
    },
  );

  // 兜底同步（replace）：任何路径（选择/新建/删除回落/popstate 恢复）导致激活
  // 变化，若与 URL 当前值不一致则 replaceState 同步。覆盖 selectConversationWithDraft
  // 之外的两条路径——新建会话（createConversation）、删除当前会话后的回落
  // （deleteConversation 内 conversations[0]?.id）。replace 不污染历史栈：
  // 删除回落/新建视为"开新文档"而非"导航"。selectConversationWithDraft 内的
  // push 已同步 URL，watch 触发时 URL 已一致、跳过 replace，无重复。
  //
  // 同时在此发 active-conversation-changed（PR8 §2.5）：嵌入态下宿主列表的
  // 高亮依赖激活态信号——pushState/replaceState 都不触发 popstate，宿主无法
  // 靠监听地址栏感知激活变化，必须显式通知。单点覆盖所有激活路径（含初始
  // hydrate 后的首次激活，顺带解决宿主 MOUNTED 时 ?c= 尚未写入的高亮竞态）。
  watch(
    conversations.activeConversationId,
    (id) => {
      // 嵌入态（qiankun）不写地址栏：URL 归宿主（见 selectConversationWithDraft
      // 注释），只发通知，由宿主 router.replace 同步 path 参数与菜单高亮。
      if (!window.__POWERED_BY_QIANKUN__) {
        const urlId = readConversationIdFromUrl();
        if (urlId !== (id || null)) {
          writeConversationIdToUrl(id ?? "", "replace");
        }
      }
      notifyHostActiveConversationChanged(id ?? "");
    },
  );

  // 校验 id 有效后切换会话（popstate 恢复 + 宿主 postMessage 切换共用）。
  // 无效 id（已删除会话的历史条目、宿主传入不存在的 id）静默跳过，watch 兜底会
  // replace 同步 URL。selectConversationWithDraft 内的 push 去重保证不重复进栈。
  function switchToConversationIfValid(id: string) {
    if (!id || id === conversations.activeConversationId.value) return;
    const exists = conversations.conversations.value.some((item) => item.id === id);
    if (!exists) return;
    selectConversationWithDraft(id);
  }

  // popstate 恢复：浏览器前进/后退。读 URL，校验后切换。
  function onPopState() {
    // 嵌入态（qiankun）跳过：前进/后退由宿主 vue-router 接管——宿主路由
    // path 参数变化后经通信桥发 select-conversation 驱动子应用切换，
    // 子应用再读 ?c 会与宿主 URL 方案（path 参数）双重驱动、相互干扰。
    if (window.__POWERED_BY_QIANKUN__) return;
    const id = readConversationIdFromUrl();
    if (!id) return;
    switchToConversationIfValid(id);
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
    // 重命名实际完成后才通知宿主刷新列表（PR8）——hostActions.rename 只是
    // 打开弹窗，在那里通知会让宿主刷到旧标题。
    notifyHostConversationsChanged();
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
    const saved = await images.renameImage(imageId, nextName);
    analytics.setContext({ imageId });
    track("image.renamed", { imageId }, "system");
    if (saved) {
      feedback.notifySuccess("图片已重命名。");
    } else {
      feedback.notifyError("重命名失败，本地保存出错，请重试。");
    }
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
    // 嵌入态且宿主选择隐藏子应用侧边栏时,会话的删/改入口由 header 承载
    // (独立态走侧边栏 ConversationSidebar 的行内按钮)。
    embeddedSidebarHidden: computed(
      () => settings.isEmbedded.value && settings.hideSidebarInEmbed.value,
    ),
    companionStatus: computed(() => ({
      show: settings.connectionMode.value === "localCompanion",
      online: companionStore.companionOnline,
      version: companionStore.companionHealth?.version,
    })),
  });
  const chatMessages = proxyRefs({
    activeAttachmentIds: attachedImageIds,
    activeMessages: conversations.activeMessages,
    // 聊天区向上翻页（server 模式分页 PR-d）
    hasMoreHistory: computed(() => conversations.messagesNextCursor !== null),
    loadingHistory: conversations.isLoadingEarlierMessages,
  });
  const chatActions = {
    closeAllEditors: composerState.closeAllEditors,
    copyText,
    generateAnother: generation.generateAnother,
    loadEarlierMessages: () => void conversations.loadEarlierMessages(),
    loadMessageConfig,
    openConversations: composerState.openConversations,
    openSettings: openSettingsDefault,
    // 嵌入态隐藏侧边栏时,header 的删/改按钮复用侧边栏动作(单一弹框来源)。
    // deleteConversation 不能直接转 sidebar.deleteConversation——后者(=drafts.
    // deleteConversationWithDraft)不带 notifyHostConversationsChanged,嵌入态下
    // 子应用会话列表已变但宿主菜单不刷新(被删项残留)。create 同理。这里与
    // setHostActions.delete 对齐:删完显式通知宿主刷新。
    deleteConversation: async (id: string) => {
      await sidebar.deleteConversation(id);
      notifyHostConversationsChanged();
    },
    renameConversation: (id: string) => sidebar.renameConversation(id),
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
    images: computed(() =>
      images.imageAssets.value.filter((image) => !image.isTransientMask),
    ),
    importBackup: backup.importBackup,
    initialBatchPanel: settingsInitialBatchPanel,
    initialTab: settingsInitialTab,
    isOpen: isSettingsOpen,
    messages,
    model: settings.model,
    setModel: (value: string) => settings.setDirectModel(value),
    modelOptions: settings.directModelOptions,
    modelsProbe: settings.directModelsProbe,
    probeModels: settings.probeDirectModels,
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
    analyticsInsights: analyticsInsightsRef,
    refreshAnalyticsInsights: analytics.refreshAnalyticsInsights,
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

// 存储错误节流：高频的草案/预览写入失败不应刷屏。相同错误消息在窗口内只弹一次。
const STORAGE_ERROR_THROTTLE_MS = 5000;
const storageErrorLastShown = new Map<string, number>();

function reportStorageError(error: unknown) {
  console.error("Failed to access local studio storage.", error);
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  const lastShown = storageErrorLastShown.get(message) ?? 0;
  if (now - lastShown < STORAGE_ERROR_THROTTLE_MS) return;
  storageErrorLastShown.set(message, now);
  try {
    useFeedbackStore().notifyWarning(
      "本地保存失败，部分更改可能未持久化（详情见控制台）。",
    );
  } catch {
    // 反馈 store 不可用时静默降级（如初始化阶段），已有 console.error 兜底。
  }
}
