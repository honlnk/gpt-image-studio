import { computed, nextTick, onMounted, ref, watch } from "vue";
import { listConversations, saveConversation, saveConversations } from "../services/conversations";
import { loadImageBlob, listImageAssets, saveImageAsset, saveImageAssets, saveImageBlob } from "../services/imageAssets";
import { base64ToBlob, editImage, generateImage } from "../services/imagesApi";
import { listMessages, saveMessage, saveMessages } from "../services/messages";
import { loadSettings, saveSettings } from "../services/settings";
import type {
  AppSettings,
  Conversation,
  EditorKey,
  GenerationParams,
  ImageAsset,
  Message,
} from "../types/studio";

const DEFAULT_API_BASE_URL = "https://code.mrzengchn.com/v1/images";
const STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
} as const;

const SEEDED_CONVERSATIONS: Conversation[] = [
  {
    id: "c-1",
    title: "咖啡馆海报探索",
    summary: "复古橱窗、暖光、手写标题",
    createdAt: "10:24",
    updatedAt: "刚刚",
    updatedAtMs: 3,
  },
  {
    id: "c-2",
    title: "产品图背景替换",
    summary: "白底耳机改成工作台场景",
    createdAt: "昨天",
    updatedAt: "昨天",
    updatedAtMs: 2,
  },
  {
    id: "c-3",
    title: "头像风格统一",
    summary: "把多张头像调整成同一视觉",
    createdAt: "周三",
    updatedAt: "周三",
    updatedAtMs: 1,
  },
];

const SEEDED_MESSAGES: Message[] = [
  {
    id: "m-1",
    conversationId: "c-1",
    role: "user",
    content: "生成一张复古咖啡馆开业海报，画面里有雨夜街道和温暖橱窗。",
    referencedImageIds: [],
    resultImageIds: [],
    status: "success",
    createdAt: "10:24",
    createdAtMs: 1,
  },
  {
    id: "m-2",
    conversationId: "c-1",
    role: "assistant",
    content: "已生成一张候选海报。",
    referencedImageIds: [],
    resultImageIds: ["img-1"],
    status: "success",
    createdAt: "10:25",
    createdAtMs: 2,
  },
  {
    id: "m-3",
    conversationId: "c-1",
    role: "user",
    content: "保留这个氛围，但把文字区域留得更干净一点。",
    referencedImageIds: ["img-1"],
    resultImageIds: [],
    status: "success",
    createdAt: "10:30",
    createdAtMs: 3,
  },
  {
    id: "m-4",
    conversationId: "c-1",
    role: "assistant",
    content: "正在基于引用图调整版式。",
    referencedImageIds: ["img-1"],
    resultImageIds: [],
    status: "pending",
    createdAt: "10:31",
    createdAtMs: 4,
  },
  {
    id: "m-5",
    conversationId: "c-2",
    role: "user",
    content: "把这张产品图放到简洁的木质桌面上，光线自然一点。",
    referencedImageIds: ["img-2"],
    resultImageIds: [],
    status: "success",
    createdAt: "昨天",
    createdAtMs: 5,
  },
  {
    id: "m-6",
    conversationId: "c-2",
    role: "assistant",
    content: "编辑失败，后续会提供重试入口。",
    referencedImageIds: ["img-2"],
    resultImageIds: [],
    status: "error",
    createdAt: "昨天",
    createdAtMs: 6,
  },
];

const SEEDED_IMAGE_ASSETS: ImageAsset[] = [
  {
    id: "img-1",
    name: "雨夜咖啡馆海报",
    source: "generated",
    prompt: "复古咖啡馆开业海报，雨夜街道，暖光橱窗",
    createdAt: "10:25",
    createdAtMs: 4,
  },
  {
    id: "img-2",
    name: "耳机产品原图",
    source: "imported",
    prompt: "用户导入的参考图",
    createdAt: "昨天",
    createdAtMs: 3,
  },
  {
    id: "img-3",
    name: "柔和头像草图",
    source: "generated",
    prompt: "柔和光线，干净背景，半身头像",
    createdAt: "周三",
    createdAtMs: 2,
  },
  {
    id: "img-4",
    name: "城市霓虹封面",
    source: "generated",
    prompt: "赛博城市，霓虹灯，电影感封面",
    createdAt: "周一",
    createdAtMs: 1,
  },
];

export function useStudioState() {
  const model = ref("gpt-image-2");
  const apiKey = ref(readStorage(STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(
    readStorage(STORAGE_KEYS.apiBaseUrl, DEFAULT_API_BASE_URL),
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
    { value: "transparent", label: "透明" },
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
  const composerText = ref("");
  const attachedImages = ref<string[]>([]);

  const conversations = ref<Conversation[]>([...SEEDED_CONVERSATIONS]);
  const activeConversationId = ref("c-1");
  const messages = ref<Message[]>([...SEEDED_MESSAGES]);
  const imageAssets = ref<ImageAsset[]>([...SEEDED_IMAGE_ASSETS]);

  const activeConversation = computed(() =>
    conversations.value.find((item) => item.id === activeConversationId.value),
  );
  const activeMessages = computed(() =>
    messages.value.filter(
      (message) => message.conversationId === activeConversationId.value,
    ),
  );
  const activeAttachments = computed(() =>
    attachedImages.value
      .map((id) => imageAssets.value.find((image) => image.id === id))
      .filter((image): image is ImageAsset => Boolean(image)),
  );
  const canSend = computed(() =>
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

      if (savedConversations.length) {
        conversations.value = savedConversations;
        activeConversationId.value = savedConversations[0].id;
      } else {
        await saveConversations(SEEDED_CONVERSATIONS);
      }

      if (savedMessages.length) {
        const restoredMessages = normalizeRestoredMessages(savedMessages);
        messages.value = restoredMessages;
        await persistNormalizedMessages(savedMessages, restoredMessages);
      } else {
        await saveMessages(SEEDED_MESSAGES);
      }

      if (savedImageAssets.length) {
        imageAssets.value = await hydrateImagePreviews(savedImageAssets);
      } else {
        await saveImageAssets(SEEDED_IMAGE_ASSETS);
      }
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

  async function createConversation() {
    const id = `c-${Date.now()}`;
    const conversation = {
      id,
      title: "新的图片创作",
      summary: "从一句 prompt 开始",
      createdAt: "刚刚",
      updatedAt: "刚刚",
      updatedAtMs: Date.now(),
    };

    conversations.value.unshift(conversation);
    activeConversationId.value = id;
    await persistConversation(conversation);
  }

  function attachImage(id: string) {
    if (!attachedImages.value.includes(id)) {
      attachedImages.value.push(id);
    }
  }

  function removeAttachment(id: string) {
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
  }

  async function submitMessage() {
    if (!canSend.value) return;

    const now = Date.now();
    const conversationId = activeConversationId.value;
    const text = composerText.value.trim() || "基于引用图片继续编辑。";
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
    background.value = settings.defaults.background;
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
      const imageId = `img-${now}`;
      const blobKey = `blob-${now}`;
      const imageAsset: ImageAsset = {
        id: imageId,
        blobKey,
        name: titleFromPrompt(prompt),
        source: "generated",
        mimeType,
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
    if (references.length > 1) {
      throw new Error("目前一次只支持编辑一张引用图片。");
    }

    const reference = imageById(references[0]);
    if (!reference?.blobKey) {
      throw new Error("引用图片缺少本地文件数据，无法编辑。");
    }

    const image = await loadImageBlob(reference.blobKey);
    if (!image) {
      throw new Error("无法读取引用图片文件，请重新生成或导入图片。");
    }

    return editImage({
      apiBaseUrl: apiBaseUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      prompt,
      params,
      image,
      imageName: filenameFromAsset(reference),
    });
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

        return {
          ...asset,
          previewUrl: URL.createObjectURL(blob),
        };
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
    formatLabel,
    formatOptions,
    imageAssets,
    imageById,
    imageHeight,
    imageModeLabel,
    imageWidth,
    isEditorExpanded,
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
