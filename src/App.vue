<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

type MessageRole = "user" | "assistant";
type MessageStatus = "pending" | "success" | "error";
type ImageSource = "generated" | "imported";

type Conversation = {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
};

type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  referencedImageIds: string[];
  resultImageIds: string[];
  status: MessageStatus;
  createdAt: string;
};

type ImageAsset = {
  id: string;
  name: string;
  source: ImageSource;
  prompt: string;
  createdAt: string;
};

const DEFAULT_API_BASE_URL = "https://code.mrzengchn.com/v1/images";
const STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
} as const;

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
type EditorKey = "size" | "quality" | "background" | "format";
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
</script>

<template>
  <main class="flex h-screen bg-white text-gray-900 antialiased">
    <!-- 左侧会话栏 -->
    <aside
      class="flex w-[260px] shrink-0 flex-col bg-[#171717] text-gray-100 max-md:hidden"
      aria-label="历史会话"
    >
      <div class="flex items-center justify-between px-3 pt-3 pb-1">
        <button
          class="flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-white/10"
          type="button"
          @click="createConversation"
        >
          + 新建会话
        </button>
        <button
          class="cursor-pointer rounded-lg p-2 text-sm transition-colors hover:bg-white/10"
          aria-label="打开设置"
          type="button"
          @click="openSettings"
        >
          ⚙
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-2 py-1">
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="[
            'mb-0.5 w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors',
            conversation.id === activeConversationId
              ? 'bg-white/10 text-white'
              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
          ]"
          type="button"
          @click="selectConversation(conversation.id)"
        >
          <span class="block truncate">{{ conversation.title }}</span>
        </button>
      </nav>

      <div class="border-t border-white/10 p-3">
        <div class="text-xs text-gray-500">GPT Image Studio</div>
      </div>
    </aside>

    <!-- 中间聊天区 -->
    <section class="flex min-w-0 flex-1 flex-col" aria-label="聊天工作区">
      <header
        class="flex items-center justify-between border-b border-gray-200 px-4 py-3"
      >
        <h1 class="truncate text-base font-semibold text-gray-800">
          {{ activeConversation?.title }}
        </h1>
        <div class="flex items-center gap-1">
          <button
            class="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
            type="button"
            @click="isLibraryOpen = !isLibraryOpen"
          >
            {{ isLibraryOpen ? "隐藏图片库" : "图片库" }}
          </button>
        </div>
      </header>

      <!-- 消息流 -->
      <div class="flex-1 overflow-y-auto">
        <div class="mx-auto max-w-[768px] px-4 py-6">
          <article
            v-for="message in activeMessages"
            :key="message.id"
            :class="[
              'mb-6 rounded-2xl px-5 py-4',
              message.role === 'user' ? 'bg-gray-50' : '',
              message.status === 'error' ? 'bg-red-50' : '',
            ]"
          >
            <div class="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
              <span class="font-semibold text-gray-700">
                {{ message.role === "user" ? "你" : "Image Studio" }}
              </span>
              <span>{{ message.createdAt }}</span>
            </div>

            <p class="text-[15px] leading-relaxed text-gray-800">
              {{ message.content }}
            </p>

            <!-- 引用图片 -->
            <div
              v-if="message.referencedImageIds.length"
              class="mt-3 flex flex-wrap gap-2"
            >
              <button
                v-for="imageId in message.referencedImageIds"
                :key="imageId"
                class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                type="button"
                @click="attachImage(imageId)"
              >
                {{ imageById(imageId)?.name }}
              </button>
            </div>

            <!-- 生成中 -->
            <div v-if="message.status === 'pending'" class="mt-3">
              <span
                class="inline-flex items-center gap-1.5 text-sm text-gray-400"
              >
                <span
                  class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400"
                ></span>
                生成中...
              </span>
            </div>

            <!-- 生成结果 -->
            <div
              v-if="message.resultImageIds.length"
              class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <figure
                v-for="imageId in message.resultImageIds"
                :key="imageId"
                class="overflow-hidden rounded-xl border border-gray-200"
              >
                <div
                  class="flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400"
                >
                  {{ imageById(imageId)?.name }}
                </div>
                <figcaption class="flex items-center justify-between px-3 py-2">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">
                      {{ imageById(imageId)?.name }}
                    </div>
                    <div class="truncate text-xs text-gray-500">
                      {{ imageById(imageId)?.prompt }}
                    </div>
                  </div>
                  <button
                    class="shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                    type="button"
                    @click="attachImage(imageId)"
                  >
                    引用
                  </button>
                </figcaption>
              </figure>
            </div>

            <!-- 重试 -->
            <button
              v-if="message.status === 'error'"
              class="mt-3 cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              type="button"
              @click="retryMessage(message)"
            >
              重试
            </button>
          </article>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="border-t border-gray-200 bg-white px-4 py-3" @click="closeAllEditors">
        <form class="mx-auto max-w-[768px]" @submit.prevent="submitMockMessage">
          <!-- 编辑器区域 -->
          <div
            :class="[
              'editor-collapse mb-2',
              isEditorExpanded ? 'editor-collapse--open' : '',
            ]"
            @click.stop
          >
            <div class="editor-collapse__inner">
              <!-- 尺寸编辑器 -->
              <div v-if="activeEditor === 'size'" class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="preset in sizePresets"
                  :key="preset"
                  :class="[
                    'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                    activeSizePreset === preset
                      ? 'border-gray-400 bg-gray-100 text-gray-900'
                      : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                  ]"
                  type="button"
                  @click="applySizePreset(preset)"
                >
                  {{ preset === 'custom' ? '自定义' : preset === 'auto' ? '自动' : preset }}
                </button>
                <div v-if="activeSizePreset === 'custom'" class="flex items-center gap-2">
                  <input
                    v-model.number="imageWidth"
                    class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
                    type="number"
                    min="16"
                    max="3840"
                    step="16"
                    placeholder="宽"
                  />
                  <span class="text-xs text-gray-400">×</span>
                  <input
                    v-model.number="imageHeight"
                    class="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-gray-400"
                    type="number"
                    min="16"
                    max="3840"
                    step="16"
                    placeholder="高"
                  />
                </div>
              </div>

              <!-- 质量编辑器 -->
              <div v-if="activeEditor === 'quality'" class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="opt in qualityOptions"
                  :key="opt.value"
                  :class="[
                    'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                    quality === opt.value
                      ? 'border-gray-400 bg-gray-100 text-gray-900'
                      : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                  ]"
                  type="button"
                  @click="quality = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>

              <!-- 背景编辑器 -->
              <div v-if="activeEditor === 'background'" class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="opt in backgroundOptions"
                  :key="opt.value"
                  :class="[
                    'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                    background === opt.value
                      ? 'border-gray-400 bg-gray-100 text-gray-900'
                      : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                  ]"
                  type="button"
                  @click="background = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>

              <!-- 格式编辑器 -->
              <div v-if="activeEditor === 'format'" class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="opt in formatOptions"
                  :key="opt.value"
                  :class="[
                    'cursor-pointer rounded border px-1.5 py-0.5 text-xs transition-colors',
                    outputFormat === opt.value
                      ? 'border-gray-400 bg-gray-100 text-gray-900'
                      : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                  ]"
                  type="button"
                  @click="outputFormat = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- 参数标签 -->
          <div class="mb-2 flex flex-wrap items-center gap-1.5" @click.stop>
            <span
              class="cursor-not-allowed rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400"
              >模型: {{ model }}</span
            >
            <button
              class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
              type="button"
              @click="toggleEditor('size')"
            >
              尺寸: {{ sizeLabel }}
            </button>
            <button
              class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
              type="button"
              @click="toggleEditor('quality')"
            >
              质量: {{ qualityLabel }}
            </button>
            <button
              class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
              type="button"
              @click="toggleEditor('background')"
            >
              背景: {{ backgroundLabel }}
            </button>
            <button
              class="cursor-pointer rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-200"
              type="button"
              @click="toggleEditor('format')"
            >
              格式: {{ formatLabel }}
            </button>
          </div>

          <!-- 附件预览 -->
          <div
            v-if="activeAttachments.length"
            class="mb-2 flex flex-wrap gap-2"
          >
            <div
              v-for="image in activeAttachments"
              :key="image.id"
              class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm"
            >
              <span class="truncate text-gray-700">{{ image.name }}</span>
              <button
                class="cursor-pointer rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                type="button"
                @click="removeAttachment(image.id)"
              >
                ×
              </button>
            </div>
          </div>

          <!-- 输入框 + 发送 -->
          <div
            class="flex items-end gap-2 rounded-2xl border border-gray-300 bg-white px-3 py-2 shadow-sm transition-shadow focus-within:border-gray-400 focus-within:shadow-md"
          >
            <label class="sr-only" for="composerText">输入图片需求</label>
            <textarea
              id="composerText"
              v-model="composerText"
              class="max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
              placeholder="描述你想生成的图片..."
              rows="1"
            />
            <button
              class="shrink-0 cursor-pointer rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
              :disabled="!canSend"
              type="submit"
            >
              发送
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- 右侧图片库 -->
    <aside
      :class="[
        'flex w-[300px] shrink-0 flex-col border-l border-gray-200 bg-white max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-10 max-lg:transition-transform max-lg:duration-200',
        isLibraryOpen
          ? 'max-lg:translate-x-0'
          : 'max-lg:translate-x-full max-lg:hidden',
      ]"
      aria-label="图片库"
    >
      <div
        class="flex items-center justify-between border-b border-gray-200 px-4 py-3"
      >
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-gray-800">图片库</span>
          <span class="text-sm text-gray-500">
            {{ imageAssets.length }} 张图片
          </span>
        </div>
        <button
          class="cursor-pointer rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:hidden"
          type="button"
          @click="isLibraryOpen = false"
        >
          ✕
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <article
          v-for="image in imageAssets"
          :key="image.id"
          class="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 p-2 transition-colors hover:bg-gray-50"
        >
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400"
          >
            img
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-gray-800">
              {{ image.name }}
            </div>
            <div class="truncate text-xs text-gray-500">
              {{ image.source === "generated" ? "生成图" : "参考图" }} ·
              {{ image.createdAt }}
            </div>
          </div>
          <button
            class="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            type="button"
            @click="attachImage(image.id)"
          >
            引用
          </button>
        </article>
      </div>
    </aside>

    <!-- 设置弹窗 -->
    <Teleport to="body">
      <div
        v-if="isSettingsOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        role="presentation"
        @click.self="closeSettings"
      >
        <section
          aria-labelledby="settingsTitle"
          aria-modal="true"
          class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          role="dialog"
        >
          <div class="mb-5 flex items-start justify-between">
            <div>
              <h2
                id="settingsTitle"
                class="text-lg font-semibold text-gray-900"
              >
                接口设置
              </h2>
              <p class="mt-0.5 text-sm text-gray-500">
                当前仍使用浏览器本地配置，后续会迁移到 IndexedDB 设置表。
              </p>
            </div>
            <button
              class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="关闭设置"
              type="button"
              @click="closeSettings"
            >
              ✕
            </button>
          </div>

          <div class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            API key 会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
          </div>

          <div class="space-y-4">
            <div>
              <label
                class="mb-1 block text-sm font-medium text-gray-700"
                for="apiKey"
                >OpenAI API key</label
              >
              <input
                id="apiKey"
                v-model="apiKey"
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
                autocomplete="off"
                placeholder="sk-..."
                type="password"
              />
            </div>

            <div>
              <label
                class="mb-1 block text-sm font-medium text-gray-700"
                for="apiBaseUrl"
                >API Base URL</label
              >
              <input
                id="apiBaseUrl"
                v-model="apiBaseUrl"
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
                type="url"
              />
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              class="cursor-pointer rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              type="button"
              @click="closeSettings"
            >
              完成
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.editor-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.2s ease-out;
}

.editor-collapse--open {
  grid-template-rows: 1fr;
}

.editor-collapse__inner {
  overflow: hidden;
}
</style>
