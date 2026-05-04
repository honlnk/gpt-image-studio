import { computed, nextTick, onMounted, ref, watch } from "vue";
import { deleteConversation as deleteConversationRecord, listConversations, saveConversation } from "../services/conversations";
import { deleteImageAsset, deleteImageBlob, loadImageBlob, listImageAssets, saveImageAsset, saveImageBlob } from "../services/imageAssets";
import { base64ToBlob, editImage, generateImage, getCustomSizeError } from "../services/imagesApi";
import { readImageDimensions } from "../services/imageMetadata";
import { deleteMessage, listMessages, saveMessage } from "../services/messages";
import { loadSettings, saveSettings } from "../services/settings";
import type {
  AppSettings,
  Conversation,
  EditorKey,
  GenerationParams,
  ImageAsset,
  Message,
} from "../types/studio";

const STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
  draftAttachments: "gpt-image-studio:draft-attachments",
  draftComposerText: "gpt-image-studio:draft-composer-text",
} as const;

const LEGACY_SEED_CONVERSATION_IDS = new Set(["c-1", "c-2", "c-3"]);
const LEGACY_SEED_MESSAGE_IDS = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
const LEGACY_SEED_IMAGE_IDS = new Set(["img-1", "img-2", "img-3", "img-4"]);

export function useStudioState() {
  const model = ref("gpt-image-2");
  const apiKey = ref(readStorage(STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(
    readStorage(STORAGE_KEYS.apiBaseUrl, ""),
  );
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
  const activeSizePreset = ref<GenerationParams["size"]>("auto");
  const sizePresets = ["auto", "1024x1024", "1536x1024", "1024x1536", "custom"] as const;
  const sizeLabel = computed(() => {
    if (activeSizePreset.value === "auto") return "自动";
    if (activeSizePreset.value === "custom") return `${imageWidth.value} x ${imageHeight.value}`;
    return activeSizePreset.value;
  });
  const customSizeError = computed(() => {
    if (activeSizePreset.value !== "custom") return "";

    return getCustomSizeError(imageWidth.value, imageHeight.value);
  });
  const quality = ref<GenerationParams["quality"]>("auto");
  const background = ref<GenerationParams["background"]>("auto");
  const outputFormat = ref<GenerationParams["outputFormat"]>("png");
  const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
  ] as const;
  const backgroundOptions = [
    { value: "auto", label: "自动" },
    { value: "opaque", label: "不透明" },
  ] as const;
  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
    { value: "jpeg", label: "JPEG" },
  ] as const;
  const qualityLabel = computed(
    () => qualityOptions.find((o) => o.value === quality.value)?.label ?? quality.value,
  );
  const backgroundLabel = computed(
    () => backgroundOptions.find((o) => o.value === background.value)?.label ?? background.value,
  );
  const formatLabel = computed(
    () => formatOptions.find((o) => o.value === outputFormat.value)?.label ?? outputFormat.value,
  );
  const isHydrated = ref(false);
  const isSettingsOpen = ref(false);
  const isLibraryOpen = ref(false);
  const activeEditor = ref<EditorKey | null>(null);
  const isEditorExpanded = ref(false);
  let conversationWriteQueue = Promise.resolve();
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
  const attachedImages = ref<string[]>(
    readJsonStorage<string[]>(STORAGE_KEYS.draftAttachments, []),
  );

  const conversations = ref<Conversation[]>([]);
  const activeConversationId = ref("");
  const messages = ref<Message[]>([]);
  const imageAssets = ref<ImageAsset[]>([]);

  const activeConversation = computed(() =>
    conversations.value.find((item) => item.id === activeConversationId.value),
  );
  const activeMessages = computed(() =>
    messages.value.filter(
      (message) => message.conversationId === activeConversationId.value,
    ),
  );
  const isGenerating = computed(() =>
    messages.value.some((message) => message.status === "pending"),
  );
  const activeAttachments = computed(() =>
    attachedImages.value
      .map((id) => imageAssets.value.find((image) => image.id === id))
      .filter((image): image is ImageAsset => Boolean(image)),
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

  watch(
    [apiKey, apiBaseUrl, model, activeSizePreset, imageWidth, imageHeight, quality, background, outputFormat],
    () => {
      if (!isHydrated.value) return;
      void saveSettings(currentSettings()).catch(reportStorageError);
    },
  );

  watch(composerText, (value) => {
    writeStorage(STORAGE_KEYS.draftComposerText, value);
  });

  watch(
    attachedImages,
    (value) => {
      writeStorage(STORAGE_KEYS.draftAttachments, JSON.stringify(value));
    },
    { deep: true },
  );

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
        await saveSettings(currentSettings());
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
    } catch (error) {
      reportStorageError(error);
    } finally {
      isHydrated.value = true;
    }
  }

  function openSettings() {
    isSettingsOpen.value = true;
  }

  function closeSettings() {
    isSettingsOpen.value = false;
  }

  function selectConversation(id: string) {
    activeConversationId.value = id;
  }

  async function deleteConversation(id: string) {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) return;

    const confirmed = window.confirm(`确定删除会话“${conversation.title}”吗？聊天记录会被移除，图片库中的图片会保留。`);
    if (!confirmed) return;

    const deletedMessages = messages.value.filter(
      (message) => message.conversationId === id,
    );
    conversations.value = conversations.value.filter((item) => item.id !== id);
    messages.value = messages.value.filter((message) => message.conversationId !== id);

    if (activeConversationId.value === id) {
      activeConversationId.value = conversations.value[0]?.id ?? "";
      attachedImages.value = [];
      composerText.value = "";
    }

    await Promise.all([
      deleteConversationRecord(id),
      ...deletedMessages.map((message) => deleteMessage(message.id)),
    ]).catch(reportStorageError);
  }

  async function createConversation() {
    const conversation = await createConversationRecord({
      title: "新的图片创作",
      summary: "尚未开始",
      updatedAtMs: Date.now(),
    });
    activeConversationId.value = conversation.id;
  }

  async function createConversationRecord(input: {
    title: string;
    summary: string;
    updatedAtMs: number;
  }) {
    const id = `c-${input.updatedAtMs}`;
    const conversation: Conversation = {
      id,
      title: input.title,
      summary: input.summary,
      createdAt: "刚刚",
      updatedAt: "刚刚",
      updatedAtMs: input.updatedAtMs,
    };

    conversations.value.unshift(conversation);
    activeConversationId.value = id;
    await persistConversation(conversation);
    return conversation;
  }

  function attachImage(id: string) {
    if (!attachedImages.value.includes(id)) {
      attachedImages.value.push(id);
    }
  }

  function removeAttachment(id: string) {
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
  }

  async function deleteImage(id: string) {
    const image = imageById(id);
    if (!image) return;

    const relatedMessages = messages.value.filter(
      (message) =>
        message.referencedImageIds.includes(id) ||
        message.resultImageIds.includes(id),
    );
    const isAttached = attachedImages.value.includes(id);

    const confirmMessage = relatedMessages.length || isAttached
      ? "这张图片正在被聊天记录或当前输入引用，删除后聊天记录中会保留无法显示的占位。确定删除吗？"
      : "确定从图片库中删除这张图片吗？";
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    attachedImages.value = attachedImages.value.filter((item) => item !== id);
    imageAssets.value = imageAssets.value.filter((item) => item.id !== id);

    await Promise.all([
      deleteImageAsset(id),
      image.blobKey ? deleteImageBlob(image.blobKey) : Promise.resolve(),
    ]).catch(reportStorageError);
  }

  async function importImages(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const importedAssets = await Promise.all(
      imageFiles.map((file) => importImageFile(file)),
    );

    imageAssets.value = [...importedAssets, ...imageAssets.value];
    importedAssets.forEach((asset) => attachImage(asset.id));
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
    const updatedConversation = updateConversationSummary(conversationId, text, now);
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

  function updateConversationSummary(conversationId: string, text: string, updatedAtMs = Date.now()) {
    const conversation = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return null;

    conversation.title = text.length > 16 ? `${text.slice(0, 16)}...` : text;
    conversation.summary = imageModeLabel.value;
    conversation.updatedAt = "刚刚";
    conversation.updatedAtMs = updatedAtMs;

    conversations.value = [
      conversation,
      ...conversations.value.filter((item) => item.id !== conversationId),
    ];

    return conversation;
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

  function imageById(id: string) {
    return imageAssets.value.find((image) => image.id === id);
  }

  function applySizePreset(preset: GenerationParams["size"]) {
    if (preset === "auto") {
      activeSizePreset.value = "auto";
    } else if (preset === "custom") {
      activeSizePreset.value = "custom";
    } else {
      activeSizePreset.value = preset;
      const [w, h] = preset.split("x").map(Number);
      imageWidth.value = w;
      imageHeight.value = h;
    }
  }

  function applySettings(settings: AppSettings) {
    apiKey.value = settings.apiKey;
    apiBaseUrl.value = settings.apiBaseUrl;
    model.value = settings.model;
    activeSizePreset.value = settings.defaults.size;
    imageWidth.value = settings.defaults.width;
    imageHeight.value = settings.defaults.height;
    quality.value = settings.defaults.quality;
    background.value = normalizeBackground(settings.defaults.background);
    outputFormat.value = settings.defaults.outputFormat;
  }

  function currentSettings(): AppSettings {
    return {
      apiKey: apiKey.value.trim(),
      apiBaseUrl: apiBaseUrl.value.trim(),
      model: model.value,
      defaults: currentGenerationParams(),
      storageMode: "indexeddb",
    };
  }

  function currentGenerationParams(): GenerationParams {
    return {
      size: activeSizePreset.value,
      width: imageWidth.value,
      height: imageHeight.value,
      quality: quality.value,
      background: background.value,
      outputFormat: outputFormat.value,
    };
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
    } catch (error) {
      const message = formatError(error);
      assistantMessage.status = "error";
      assistantMessage.content = `生成失败：${message}`;
      assistantMessage.errorMessage = message;
      assistantMessage.resultImageIds = [];
      replaceMessage(assistantMessage);
      await saveMessage(toPlainMessage(assistantMessage)).catch(reportStorageError);
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

  async function importImageFile(file: File) {
    const now = Date.now() + Math.floor(Math.random() * 1000);
    const dimensions = await readImageDimensions(file);
    const imageId = `img-${now}`;
    const blobKey = `blob-${now}`;
    const imageAsset: ImageAsset = {
      id: imageId,
      blobKey,
      name: file.name || `导入图片-${now}`,
      source: "imported",
      mimeType: file.type || "image/png",
      width: dimensions?.width,
      height: dimensions?.height,
      sizeBytes: file.size,
      conversationId: activeConversationId.value || undefined,
      prompt: "用户导入的参考图",
      createdAt: "刚刚",
      updatedAt: "刚刚",
      createdAtMs: now,
      previewUrl: URL.createObjectURL(file),
    };

    await Promise.all([
      saveImageBlob(blobKey, file),
      saveImageAsset(toPlainImageAsset(imageAsset)),
    ]).catch(reportStorageError);

    return imageAsset;
  }

  function replaceMessage(message: Message) {
    messages.value = messages.value.map((item) =>
      item.id === message.id ? { ...message } : item,
    );
  }

  async function hydrateImagePreviews(assets: ImageAsset[]) {
    return Promise.all(
      assets.map(async (asset) => {
        if (!asset.blobKey) return asset;

        const blob = await loadImageBlob(asset.blobKey);
        if (!blob) return asset;

        const restoredAsset = {
          ...asset,
          previewUrl: URL.createObjectURL(blob),
        };

        if (restoredAsset.width && restoredAsset.height) {
          return restoredAsset;
        }

        const dimensions = await readImageDimensions(blob);
        if (!dimensions) return restoredAsset;

        const updatedAsset = {
          ...restoredAsset,
          width: dimensions.width,
          height: dimensions.height,
        };
        await saveImageAsset(toPlainImageAsset(updatedAsset)).catch(reportStorageError);
        return updatedAsset;
      }),
    );
  }

  function persistConversation(conversation: Conversation) {
    const snapshot = toPlainConversation(conversation);
    conversationWriteQueue = conversationWriteQueue
      .catch(reportStorageError)
      .then(() => saveConversation(snapshot));

    return conversationWriteQueue.catch(reportStorageError);
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
    closeAllEditors,
    closeSettings,
    composerText,
    conversations,
    createConversation,
    customSizeError,
    deleteConversation,
    deleteImage,
    formatLabel,
    formatOptions,
    imageAssets,
    imageById,
    imageHeight,
    imageModeLabel,
    imageWidth,
    importImages,
    isEditorExpanded,
    isGenerating,
    isHydrated,
    isLibraryOpen,
    isSettingsOpen,
    model,
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
    submitMessage,
    toggleEditor,
    applySizePreset,
    attachImage,
  };
}

function readStorage(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeBackground(background: GenerationParams["background"]) {
  if (background === "transparent") return "auto";

  return background;
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore local draft persistence failures.
  }
}

function readJsonStorage<T>(key: string, fallback: T) {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
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

function toPlainConversation(conversation: Conversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    updatedAtMs: conversation.updatedAtMs,
    archivedAt: conversation.archivedAt,
  };
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
