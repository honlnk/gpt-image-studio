import { computed, nextTick, onMounted, ref, watch } from "vue";
import { createStudioBackup, restoreStudioBackup } from "../services/backups";
import { deleteConversation as deleteConversationRecord, listConversations } from "../services/conversations";
import { deleteImageAsset, deleteImageBlob, loadImageBlob, listImageAssets, saveImageAsset, saveImageBlob } from "../services/imageAssets";
import { base64ToBlob, editImage, generateImage } from "../services/imagesApi";
import { readImageDimensions } from "../services/imageMetadata";
import { deleteMessage, listMessages, saveMessage } from "../services/messages";
import { loadSettings } from "../services/settings";
import { useStudioConversations } from "./useStudioConversations";
import { useStudioFeedback } from "./useStudioFeedback";
import { useStudioImages } from "./useStudioImages";
import { useStudioSettings } from "./useStudioSettings";
import type {
  Conversation,
  EditorKey,
  GenerationParams,
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

  const isGenerating = computed(() =>
    messages.value.some((message) => message.status === "pending"),
  );
  const canSend = computed(() =>
    !isGenerating.value &&
    !customSizeError.value &&
    Boolean(composerText.value.trim() || attachedImages.value.length),
  );
  const imageModeLabel = computed(() =>
    attachedImages.value.length ? "引用图片编辑" : "文字生成图片",
  );

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

  async function submitMessage() {
    if (!canSend.value || isGenerating.value) return;

    const now = Date.now();
    const text = composerText.value.trim() || "基于引用图片继续编辑。";
    const conversation =
      activeConversation.value ??
      await createConversationRecord({
        title: titleFromPrompt(text),
        summary: imageModeLabel.value,
        updatedAtMs: now,
      });
    const conversationId = conversation.id;
    const references = [...attachedImages.value];
    const userMessage: Message = {
      id: `m-${now}`,
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt: "刚刚",
      createdAtMs: now,
      generationParams: currentGenerationParams(),
    };
    const assistantMessage: Message = {
      id: `m-${now + 1}`,
      conversationId,
      role: "assistant",
      content: references.length
        ? "正在基于引用图片生成编辑结果。"
        : "正在生成图片。",
      referencedImageIds: references,
      resultImageIds: [],
      status: "pending",
      createdAt: "刚刚",
      createdAtMs: now + 1,
      generationParams: currentGenerationParams(),
    };

    messages.value.push(userMessage, assistantMessage);
    const updatedConversation = updateConversationSummary(
      conversationId,
      text,
      imageModeLabel.value,
      now,
    );
    composerText.value = "";
    attachedImages.value = [];

    await Promise.all([
      saveMessage(toPlainMessage(userMessage)),
      saveMessage(toPlainMessage(assistantMessage)),
      updatedConversation
        ? persistConversation(updatedConversation)
        : Promise.resolve(),
    ]).catch(reportStorageError);

    await runImageRequest(text, references, assistantMessage);
  }

  async function retryMessage(message: Message) {
    message.status = "pending";
    message.content = message.referencedImageIds.length
      ? "正在基于引用图片生成编辑结果。"
      : "正在生成图片。";
    message.resultImageIds = [];
    message.errorMessage = undefined;
    await saveMessage(toPlainMessage(message)).catch(reportStorageError);

    const userMessage = [...messages.value]
      .reverse()
      .find(
        (item) =>
          item.conversationId === message.conversationId &&
          item.role === "user" &&
          (item.createdAtMs ?? 0) <= (message.createdAtMs ?? 0),
      );

    if (userMessage) {
      await runImageRequest(
        userMessage.content,
        message.referencedImageIds,
        message,
      );
    }
  }

  async function runImageRequest(
    prompt: string,
    references: string[],
    assistantMessage: Message,
  ) {
    try {
      if (!apiKey.value.trim()) {
        throw new Error("请先在设置里填写 OpenAI API key。");
      }

      if (!apiBaseUrl.value.trim()) {
        throw new Error("请先在设置里填写 API Base URL。");
      }

      const params = assistantMessage.generationParams ?? currentGenerationParams();
      const imageData = references.length
        ? await requestImageEdit(prompt, references, params)
        : await generateImage({
            apiBaseUrl: apiBaseUrl.value,
            apiKey: apiKey.value,
            model: model.value,
            prompt,
            params,
          });
      const now = Date.now();
      const mimeType = `image/${params.outputFormat}`;
      const blob = base64ToBlob(imageData, mimeType);
      const dimensions = await readImageDimensions(blob);
      const imageId = `img-${now}`;
      const blobKey = `blob-${now}`;
      const imageAsset: ImageAsset = {
        id: imageId,
        blobKey,
        name: titleFromPrompt(prompt),
        source: "generated",
        mimeType,
        width: dimensions?.width,
        height: dimensions?.height,
        sizeBytes: blob.size,
        conversationId: assistantMessage.conversationId,
        messageId: assistantMessage.id,
        prompt,
        referencedImageIds: references,
        createdAt: "刚刚",
        updatedAt: "刚刚",
        createdAtMs: now,
        previewUrl: URL.createObjectURL(blob),
      };

      assistantMessage.status = "success";
      assistantMessage.content = references.length
        ? "已基于引用图生成一张图片。"
        : "已生成一张图片。";
      assistantMessage.resultImageIds = [imageId];
      assistantMessage.errorMessage = undefined;
      imageAssets.value = [imageAsset, ...imageAssets.value];
      replaceMessage(assistantMessage);

      await Promise.all([
        saveImageBlob(blobKey, blob),
        saveImageAsset(toPlainImageAsset(imageAsset)),
        saveMessage(toPlainMessage(assistantMessage)),
      ]);
      await refreshStorageUsage();
    } catch (error) {
      const message = formatError(error);
      assistantMessage.status = "error";
      assistantMessage.content = `生成失败：${message}`;
      assistantMessage.errorMessage = message;
      assistantMessage.resultImageIds = [];
      replaceMessage(assistantMessage);
      await saveMessage(toPlainMessage(assistantMessage)).catch(reportStorageError);
      await refreshStorageUsage();
    }
  }

  async function requestImageEdit(
    prompt: string,
    references: string[],
    params: GenerationParams,
  ) {
    if (references.length > 16) {
      throw new Error("一次最多支持编辑 16 张引用图片。");
    }

    const images = await Promise.all(
      references.map(async (id) => {
        const reference = imageById(id);
        if (!reference?.blobKey) {
          throw new Error("引用图片缺少本地文件数据，无法编辑。");
        }

        const blob = await loadImageBlob(reference.blobKey);
        if (!blob) {
          throw new Error("无法读取引用图片文件，请重新生成或导入图片。");
        }

        return {
          blob,
          name: filenameFromAsset(reference),
        };
      }),
    );

    return editImage({
      apiBaseUrl: apiBaseUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      prompt,
      params,
      images,
    });
  }

  function replaceMessage(message: Message) {
    messages.value = messages.value.map((item) =>
      item.id === message.id ? { ...message } : item,
    );
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

function titleFromPrompt(prompt: string) {
  return prompt.length > 16 ? `${prompt.slice(0, 16)}...` : prompt;
}

function filenameFromAsset(asset: ImageAsset) {
  const extension = asset.mimeType === "image/jpeg"
    ? "jpeg"
    : asset.mimeType === "image/webp"
      ? "webp"
      : "png";

  return `${asset.name || asset.id}.${extension}`;
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

function toPlainMessage(message: Message): Message {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    referencedImageIds: [...message.referencedImageIds],
    resultImageIds: [...message.resultImageIds],
    status: message.status,
    createdAt: message.createdAt,
    createdAtMs: message.createdAtMs,
    generationParams: message.generationParams
      ? { ...message.generationParams }
      : undefined,
    errorMessage: message.errorMessage,
  };
}

function toPlainImageAsset(imageAsset: ImageAsset): ImageAsset {
  return {
    id: imageAsset.id,
    blobKey: imageAsset.blobKey,
    name: imageAsset.name,
    source: imageAsset.source,
    mimeType: imageAsset.mimeType,
    width: imageAsset.width,
    height: imageAsset.height,
    sizeBytes: imageAsset.sizeBytes,
    conversationId: imageAsset.conversationId,
    messageId: imageAsset.messageId,
    prompt: imageAsset.prompt,
    referencedImageIds: imageAsset.referencedImageIds
      ? [...imageAsset.referencedImageIds]
      : undefined,
    createdAt: imageAsset.createdAt,
    updatedAt: imageAsset.updatedAt,
    createdAtMs: imageAsset.createdAtMs,
  };
}
