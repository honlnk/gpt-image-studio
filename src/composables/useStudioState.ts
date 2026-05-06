import { nextTick, onMounted, ref, watch } from "vue";
import { createStudioBackup, restoreStudioBackup } from "../services/backups";
import { deleteConversation as deleteConversationRecord, listConversations } from "../services/conversations";
import { deleteImageAsset, deleteImageBlob, listImageAssets } from "../services/imageAssets";
import { deleteMessage, listMessages, saveMessage } from "../services/messages";
import { loadSettings } from "../services/settings";
import { useStudioConversations } from "./useStudioConversations";
import { useStudioFeedback } from "./useStudioFeedback";
import { useStudioGeneration } from "./useStudioGeneration";
import { useStudioImages } from "./useStudioImages";
import { useStudioSettings } from "./useStudioSettings";
import type {
  Conversation,
  EditorKey,
  ImageAsset,
  Message,
} from "../types/studio";

const STORAGE_KEYS = {
  draftComposerText: "gpt-image-studio:draft-composer-text",
} as const;

const LEGACY_SEED_CONVERSATION_IDS = new Set(["c-1", "c-2", "c-3"]);
const LEGACY_SEED_MESSAGE_IDS = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
const LEGACY_SEED_IMAGE_IDS = new Set(["img-1", "img-2", "img-3", "img-4"]);

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
  const isSettingsOpen = ref(false);
  const isLibraryOpen = ref(false);
  const activeEditor = ref<EditorKey | null>(null);
  const isEditorExpanded = ref(false);
  let expandTimer: ReturnType<typeof setTimeout> | null = null;

  function toggleEditor(key: EditorKey) {
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    if (activeEditor.value === key && isEditorExpanded.value) {
      // 关闭当前
      isEditorExpanded.value = false;
      expandTimer = setTimeout(() => {
        activeEditor.value = null;
        expandTimer = null;
      }, 200);
    } else {
      // 打开新的（先关闭再打开，避免内容跳变）
      isEditorExpanded.value = false;
      activeEditor.value = key;
      nextTick(() => {
        isEditorExpanded.value = true;
      });
    }
  }
  function closeAllEditors() {
    if (!activeEditor.value) return;
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    isEditorExpanded.value = false;
    expandTimer = setTimeout(() => {
      activeEditor.value = null;
      expandTimer = null;
    }, 200);
  }
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

  onMounted(() => {
    void hydrateFromStorage();
  });

  watch(composerText, (value) => {
    writeStorage(STORAGE_KEYS.draftComposerText, value);
  });

  async function hydrateFromStorage() {
    try {
      const [savedSettings, savedConversations, savedMessages, savedImageAssets] =
        await Promise.all([
          loadSettings(),
          listConversations(),
          listMessages(),
          listImageAssets(),
        ]);

      if (savedSettings) {
        applySettings(savedSettings);
      } else {
        await saveCurrentSettings();
      }

      await removeLegacySeedRecords(
        savedConversations,
        savedMessages,
        savedImageAssets,
      );

      const restoredConversations = savedConversations.filter(
        (conversation) => !LEGACY_SEED_CONVERSATION_IDS.has(conversation.id),
      );
      const restoredImages = savedImageAssets.filter(
        (image) =>
          !LEGACY_SEED_IMAGE_IDS.has(image.id) &&
          !(
            image.conversationId &&
            LEGACY_SEED_CONVERSATION_IDS.has(image.conversationId)
          ),
      );
      const restoredMessages = savedMessages.filter(
        (message) =>
          !LEGACY_SEED_MESSAGE_IDS.has(message.id) &&
          !LEGACY_SEED_CONVERSATION_IDS.has(message.conversationId),
      );

      conversations.value = restoredConversations;
      activeConversationId.value = restoredConversations[0]?.id ?? "";

      const normalizedMessages = normalizeRestoredMessages(restoredMessages);
      messages.value = normalizedMessages;
      await persistNormalizedMessages(restoredMessages, normalizedMessages);

      imageAssets.value = await hydrateImagePreviews(restoredImages);
      attachedImages.value = attachedImages.value.filter((id) =>
        restoredImages.some((image) => image.id === id),
      );
      await refreshStorageUsage();
    } catch (error) {
      notifyError(`读取本地数据失败：${formatError(error)}`);
      reportStorageError(error);
    } finally {
      isHydrated.value = true;
    }
  }

  async function exportBackup() {
    try {
      const backup = await createStudioBackup();
      const url = URL.createObjectURL(backup);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gpt-image-studio-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      notifySuccess("备份已开始下载。");
    } catch (error) {
      notifyError(`导出备份失败：${formatError(error)}`);
      reportStorageError(error);
    }
  }

  async function importBackup(file: File) {
    try {
      await restoreStudioBackup(file);
      conversations.value = [];
      messages.value = [];
      imageAssets.value = [];
      attachedImages.value = [];
      composerText.value = "";
      activeConversationId.value = "";
      await hydrateFromStorage();
      notifySuccess("备份已恢复，本地数据已刷新。");
    } catch (error) {
      notifyError(`恢复备份失败：${formatError(error)}`);
      reportStorageError(error);
    }
  }

  function openSettings() {
    isSettingsOpen.value = true;
  }

  function closeSettings() {
    isSettingsOpen.value = false;
  }

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

function formatError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "图片接口返回了无法解析的响应。";
  }

  return error instanceof Error ? error.message : String(error);
}

function normalizeRestoredMessages(messages: Message[]) {
  return messages.map((message) => {
    if (message.status !== "pending") return message;

    return {
      ...message,
      status: "error",
      content: "生成中断，请重试。",
      errorMessage: "页面刷新或会话中断后，未完成的生成任务不会继续运行。",
    } satisfies Message;
  });
}

async function persistNormalizedMessages(
  originalMessages: Message[],
  restoredMessages: Message[],
) {
  const changedMessages = restoredMessages.filter(
    (message, index) => message.status !== originalMessages[index]?.status,
  );

  if (!changedMessages.length) return;

  await Promise.all(changedMessages.map((message) => saveMessage(message)));
}

async function removeLegacySeedRecords(
  conversations: Conversation[],
  messages: Message[],
  imageAssets: ImageAsset[],
) {
  const staleConversations = conversations.filter((conversation) =>
    LEGACY_SEED_CONVERSATION_IDS.has(conversation.id),
  );
  const staleMessages = messages.filter(
    (message) =>
      LEGACY_SEED_MESSAGE_IDS.has(message.id) ||
      LEGACY_SEED_CONVERSATION_IDS.has(message.conversationId),
  );
  const staleImages = imageAssets.filter(
    (image) =>
      LEGACY_SEED_IMAGE_IDS.has(image.id) ||
      Boolean(
        image.conversationId &&
          LEGACY_SEED_CONVERSATION_IDS.has(image.conversationId),
      ),
  );

  if (!staleConversations.length && !staleMessages.length && !staleImages.length) {
    return;
  }

  await Promise.all([
    ...staleConversations.map((conversation) =>
      deleteConversationRecord(conversation.id),
    ),
    ...staleMessages.map((message) => deleteMessage(message.id)),
    ...staleImages.map((image) => deleteImageAsset(image.id)),
    ...staleImages
      .map((image) => image.blobKey)
      .filter((blobKey): blobKey is string => Boolean(blobKey))
      .map((blobKey) => deleteImageBlob(blobKey)),
  ]);
}
