import { computed, nextTick, ref, watch } from "vue";
import type { EditorKey, Conversation, ImageAsset, Message } from "../types/studio";

const DEFAULT_API_BASE_URL = "https://code.mrzengchn.com/v1/images";
const STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
} as const;

export function useStudioState() {
  const model = ref("gpt-image-2");
  const apiKey = ref(readStorage(STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(
    readStorage(STORAGE_KEYS.apiBaseUrl, DEFAULT_API_BASE_URL),
  );
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
  const activeSizePreset = ref("auto");
  const sizePresets = ["auto", "1024x1024", "1536x1024", "1024x1536", "custom"] as const;
  const sizeLabel = computed(() => {
    if (activeSizePreset.value === "auto") return "自动";
    if (activeSizePreset.value === "custom") return `${imageWidth.value} x ${imageHeight.value}`;
    return activeSizePreset.value;
  });
  const quality = ref("auto");
  const background = ref("auto");
  const outputFormat = ref("png");
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
  const composerText = ref("");
  const attachedImages = ref<string[]>([]);

  const conversations = ref<Conversation[]>([
    {
      id: "c-1",
      title: "咖啡馆海报探索",
      summary: "复古橱窗、暖光、手写标题",
      updatedAt: "刚刚",
    },
    {
      id: "c-2",
      title: "产品图背景替换",
      summary: "白底耳机改成工作台场景",
      updatedAt: "昨天",
    },
    {
      id: "c-3",
      title: "头像风格统一",
      summary: "把多张头像调整成同一视觉",
      updatedAt: "周三",
    },
  ]);

  const activeConversationId = ref("c-1");
  const messages = ref<Message[]>([
    {
      id: "m-1",
      conversationId: "c-1",
      role: "user",
      content: "生成一张复古咖啡馆开业海报，画面里有雨夜街道和温暖橱窗。",
      referencedImageIds: [],
      resultImageIds: [],
      status: "success",
      createdAt: "10:24",
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
    },
  ]);

  const imageAssets = ref<ImageAsset[]>([
    {
      id: "img-1",
      name: "雨夜咖啡馆海报",
      source: "generated",
      prompt: "复古咖啡馆开业海报，雨夜街道，暖光橱窗",
      createdAt: "10:25",
    },
    {
      id: "img-2",
      name: "耳机产品原图",
      source: "imported",
      prompt: "用户导入的参考图",
      createdAt: "昨天",
    },
    {
      id: "img-3",
      name: "柔和头像草图",
      source: "generated",
      prompt: "柔和光线，干净背景，半身头像",
      createdAt: "周三",
    },
    {
      id: "img-4",
      name: "城市霓虹封面",
      source: "generated",
      prompt: "赛博城市，霓虹灯，电影感封面",
      createdAt: "周一",
    },
  ]);

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

  watch(apiKey, (value) => writeStorage(STORAGE_KEYS.apiKey, value.trim()));
  watch(apiBaseUrl, (value) =>
    writeStorage(STORAGE_KEYS.apiBaseUrl, value.trim()),
  );

  function openSettings() {
    isSettingsOpen.value = true;
  }

  function closeSettings() {
    isSettingsOpen.value = false;
  }

  function selectConversation(id: string) {
    activeConversationId.value = id;
  }

  function createConversation() {
    const id = `c-${Date.now()}`;
    conversations.value.unshift({
      id,
      title: "新的图片创作",
      summary: "从一句 prompt 开始",
      updatedAt: "刚刚",
    });
    activeConversationId.value = id;
  }

  function attachImage(id: string) {
    if (!attachedImages.value.includes(id)) {
      attachedImages.value.push(id);
    }
  }

  function removeAttachment(id: string) {
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
  }

  function submitMockMessage() {
    if (!canSend.value) return;

    const conversationId = activeConversationId.value;
    const text = composerText.value.trim() || "基于引用图片继续编辑。";
    const references = [...attachedImages.value];
    const userMessageId = `m-${Date.now()}`;
    const assistantMessageId = `m-${Date.now() + 1}`;

    messages.value.push({
      id: userMessageId,
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt: "刚刚",
    });
    messages.value.push({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      content: references.length
        ? "正在基于引用图片生成编辑结果。"
        : "正在生成图片。",
      referencedImageIds: references,
      resultImageIds: [],
      status: "pending",
      createdAt: "刚刚",
    });

    updateConversationSummary(conversationId, text);
    composerText.value = "";
    attachedImages.value = [];
  }

  function updateConversationSummary(conversationId: string, text: string) {
    const conversation = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return;

    conversation.title = text.length > 16 ? `${text.slice(0, 16)}...` : text;
    conversation.summary = imageModeLabel.value;
    conversation.updatedAt = "刚刚";
  }

  function retryMessage(message: Message) {
    message.status = "pending";
    message.content = "已重新加入生成队列。";
  }

  function imageById(id: string) {
    return imageAssets.value.find((image) => image.id === id);
  }

  function applySizePreset(preset: string) {
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
    submitMockMessage,
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

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 本阶段只保留设置入口，后续会统一迁移到 IndexedDB。
  }
}
