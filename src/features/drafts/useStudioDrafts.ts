import { watch } from "vue";
import type { Ref } from "vue";
import {
  deleteConversationDraft,
  deleteConversationDrafts,
  loadConversationDraft,
  saveConversationDraft,
} from "../../services/conversationDrafts";
import { readJsonStorage, readStorage } from "../../shared/localStorage";
import type {
  ConversationDraft,
  GenerationParams,
  ImageAsset,
} from "../../types/studio";

/**
 * 草稿持久化的 localStorage 键名。
 *
 * `draftComposerText` / `draftAttachments` 是早期（按会话草稿上线前）的
 * 全局草稿键。现在用于把全局遗留草稿迁移成首次激活会话的草稿。
 * 模块级常量，多实例共享（迁移键名固定）。
 */
const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
  draftAttachments: "gpt-image-studio:draft-attachments",
} as const;

type UseStudioDraftsInput = {
  /** 应用是否已完成 hydrate（restoreFromStorage 完成）。watch 在 hydrate 前不触发。 */
  isHydrated: Ref<boolean>;
  composerText: Ref<string>;
  editModeEnabled: Ref<boolean>;
  activeEditSourceImageId: Ref<string>;
  activeEditMaskImageId: Ref<string>;
  activeConversationId: Ref<string>;
  attachedImages: Ref<string[]>;
  imageById: (id: string) => ImageAsset | undefined;

  // settings 的窄接口：只暴露草稿真正读写的字段。
  // 不传整个 settings 对象，避免 drafts 依赖面隐性扩大。
  activeSizePreset: Ref<GenerationParams["size"]>;
  imageWidth: Ref<number>;
  imageHeight: Ref<number>;
  quality: Ref<GenerationParams["quality"]>;
  background: Ref<GenerationParams["background"]>;
  outputFormat: Ref<GenerationParams["outputFormat"]>;
  applySizePreset: (preset: GenerationParams["size"]) => void;
  applySizeResolution: (resolution: string) => void;
  currentGenerationParams: () => GenerationParams;

  // conversations 的方法（非 ref）。
  selectConversation: (id: string) => void;
  createConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteConversations: (ids: string[]) => Promise<void>;

  onStorageError: (error: unknown) => void;
};

/**
 * 会话草稿管理 composable。
 *
 * 从 useStudioViewModel 抽出，负责：
 *   - 草稿的 CRUD（创建默认 / 遗留迁移 / 当前快照 / 应用恢复）
 *   - 草稿切换的串行化（draftSwitchQueue，防止并发切换竞态）
 *   - 监听 composer/参数变化，防抖保存
 *   - 会话 select/create/delete 时同步草稿
 *
 * 不负责（留在 ViewModel）：
 *   - clearConversationDraft（依赖 images/composer，且被 useStudioConversations 消费，构成环）
 *   - loadMessageConfig（含 UI 反馈，且是 chatActions 对外契约）
 *   - analytics 埋点（由 ViewModel 在 select 前包装）
 *   - onMounted 编排（时序由 ViewModel 控制）
 */
export function useStudioDrafts(input: UseStudioDraftsInput) {
  const legacyComposerText = readStorage(STORAGE_KEYS.draftComposerText, "");
  const legacyAttachedImageIds = readJsonStorage<string[]>(
    STORAGE_KEYS.draftAttachments,
    [],
  );

  // 闭包状态：防抖计时器 + 串行队列 + apply 中标志。
  // 单实例 composable（useStudioViewModel 只被 StudioShell 调用一次），无多实例串扰。
  let isApplyingDraft = false;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let draftSwitchQueue = Promise.resolve();

  // 监听 composer / 附件 / 参数变化，防抖保存当前会话草稿。
  // 与历史实现一致：hydrate 前不保存；apply 草稿期间不保存（否则会覆盖刚 apply 的值）。
  watch(
    [
      input.composerText,
      input.attachedImages,
      input.activeSizePreset,
      input.imageWidth,
      input.imageHeight,
      input.quality,
      input.background,
      input.outputFormat,
      input.editModeEnabled,
      input.activeEditSourceImageId,
      input.activeEditMaskImageId,
      input.activeConversationId,
    ],
    () => {
      if (!input.isHydrated.value || isApplyingDraft) return;
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
      generationParams: input.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function createLegacyDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: legacyComposerText,
      attachedImageIds: legacyAttachedImageIds,
      editModeEnabled: false,
      generationParams: input.currentGenerationParams(),
      updatedAtMs: Date.now(),
    };
  }

  function applyConversationDraft(draft: ConversationDraft) {
    isApplyingDraft = true;
    input.composerText.value = draft.composerText;
    input.attachedImages.value = draft.attachedImageIds.filter((id) =>
      Boolean(input.imageById(id)),
    );
    input.editModeEnabled.value = draft.editModeEnabled;
    input.activeEditSourceImageId.value = draft.editSourceImageId ?? "";
    input.activeEditMaskImageId.value = draft.editMaskImageId ?? "";
    applyGenerationParams(draft.generationParams);
    isApplyingDraft = false;
  }

  function applyGenerationParams(params: GenerationParams) {
    input.applySizeResolution(params.resolution);
    input.applySizePreset(params.size);
    input.imageWidth.value = params.width;
    input.imageHeight.value = params.height;
    input.quality.value = params.quality;
    input.background.value = params.background;
    input.outputFormat.value = params.outputFormat;
  }

  function applyUrlDraftOverrides(
    prompt: string | undefined,
    shouldApplyGenerationParams: boolean,
  ) {
    if (prompt === undefined && !shouldApplyGenerationParams) return;

    isApplyingDraft = true;
    if (prompt !== undefined) input.composerText.value = prompt;
    if (shouldApplyGenerationParams) {
      applyGenerationParams(input.currentGenerationParams());
    }
    isApplyingDraft = false;
    void saveActiveDraft().catch(input.onStorageError);
  }

  function currentConversationDraft(conversationId: string): ConversationDraft {
    return {
      conversationId,
      composerText: input.composerText.value,
      attachedImageIds: [...input.attachedImages.value],
      editModeEnabled: input.editModeEnabled.value,
      editSourceImageId: input.activeEditSourceImageId.value || undefined,
      editMaskImageId: input.activeEditMaskImageId.value || undefined,
      generationParams: input.currentGenerationParams(),
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
    const conversationId = input.activeConversationId.value;
    if (!conversationId) return;

    const draft = currentConversationDraft(conversationId);
    await saveConversationDraft(draft).catch(input.onStorageError);
  }

  /**
   * 立即保存当前会话草稿（供 ViewModel 的 loadMessageConfig 复用）。
   *
   * 不走防抖，因为 loadMessageConfig 后用户可能立即关页面。
   */
  function saveDraftForCurrentConversation() {
    return saveActiveDraft();
  }

  function selectConversationWithDraft(id: string) {
    draftSwitchQueue = draftSwitchQueue
      .catch(input.onStorageError)
      .then(async () => {
        await saveActiveDraft();
        input.selectConversation(id);
        const nextDraft = await loadConversationDraft(id).catch(input.onStorageError);
        if (nextDraft) {
          applyConversationDraft(nextDraft);
        } else {
          applyConversationDraft(createDefaultDraft(id));
        }
      });
  }

  async function createConversationWithDraft() {
    await saveActiveDraft();
    await input.createConversation();
    const id = input.activeConversationId.value;
    if (!id) return;
    applyConversationDraft(createDefaultDraft(id));
    await saveConversationDraft(currentConversationDraft(id)).catch(input.onStorageError);
  }

  async function deleteConversationWithDraft(id: string) {
    await input.deleteConversation(id);
    await deleteConversationDraft(id).catch(input.onStorageError);

    const activeId = input.activeConversationId.value;
    if (!activeId) return;
    const draft = await loadConversationDraft(activeId).catch(input.onStorageError);
    if (draft) {
      applyConversationDraft(draft);
    } else {
      applyConversationDraft(createDefaultDraft(activeId));
    }
  }

  async function deleteConversationsWithDraft(ids: string[]) {
    await input.deleteConversations(ids);
    await deleteConversationDrafts(ids).catch(input.onStorageError);

    const activeId = input.activeConversationId.value;
    if (!activeId) {
      // 无激活会话：清空 composer（由 ViewModel 的 clearConversationDraft 处理）。
      return;
    }

    const draft = await loadConversationDraft(activeId).catch(input.onStorageError);
    if (draft) {
      applyConversationDraft(draft);
    } else {
      applyConversationDraft(createDefaultDraft(activeId));
    }
  }

  /**
   * 应用启动时的草稿初始化。
   *
   * 时序由 ViewModel 控制：必须在 restoreFromStorage + applyUrlSettings + analytics.configure 之后调用。
   * `urlPrompt` / `shouldApplyUrlGenerationParams` 来自 URL 参数，用于覆盖首次草稿。
   */
  async function initDraftsOnMount(ctx: {
    urlPrompt: string | undefined;
    shouldApplyUrlGenerationParams: boolean;
  }) {
    const activeConversationId = input.activeConversationId.value;
    if (!activeConversationId) return;

    const draft = await loadConversationDraft(activeConversationId).catch(input.onStorageError);
    if (draft) {
      applyConversationDraft(draft);
      applyUrlDraftOverrides(ctx.urlPrompt, ctx.shouldApplyUrlGenerationParams);
      return;
    }

    if (legacyComposerText || legacyAttachedImageIds.length) {
      applyConversationDraft(createLegacyDraft(activeConversationId));
    } else {
      applyConversationDraft(createDefaultDraft(activeConversationId));
    }
    applyUrlDraftOverrides(ctx.urlPrompt, ctx.shouldApplyUrlGenerationParams);
  }

  return {
    selectConversationWithDraft,
    createConversationWithDraft,
    deleteConversationWithDraft,
    deleteConversationsWithDraft,
    initDraftsOnMount,
    applyGenerationParams,
    saveDraftForCurrentConversation,
  };
}
