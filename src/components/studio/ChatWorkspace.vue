<script setup lang="ts">
import { nextTick, ref } from "vue";
import { storeToRefs } from "pinia";
import { useComposerStore } from "../../stores/composerStore";
import { useGenerationStore } from "../../stores/generationStore";
import { useImagesStore } from "../../stores/imagesStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type {
  Conversation,
  Message,
} from "../../types/studio";
import ChatComposer from "../chat/ChatComposer.vue";
import EditMaskModal from "../chat/EditMaskModal.vue";
import MessageList from "../chat/MessageList.vue";
import QqGroupModal from "../ui/QqGroupModal.vue";
import { DOWNLOAD_PAGE_URL } from "../../shared/downloads";
import { openExternalUrl } from "../../services/desktopCompanion";
import { isTauriRuntime } from "../../services/storage";

type ChatWorkspaceHeader = {
  activeConversation?: Conversation;
  isLibraryOpen: boolean;
  /**
   * 嵌入态且宿主隐藏了子应用自带侧边栏(会话列表外移到宿主菜单)。
   * 此时 header 承担会话的删除/重命名入口,独立态走侧边栏行内按钮。
   */
  embeddedSidebarHidden?: boolean;
  companionStatus?: {
    show: boolean;
    online: boolean;
    version?: string;
  };
};

type ChatWorkspaceMessages = {
  activeAttachmentIds: string[];
  activeMessages: Message[];
  /** 窗口之前还有更早的历史页（server 模式分页 PR-d）。 */
  hasMoreHistory: boolean;
  loadingHistory: boolean;
};

type ChatWorkspaceActions = {
  applyEditSelection: (sourceImageId: string, maskImageId: string) => void;
  closeAllEditors: () => void;
  copyText: (text: string) => void;
  deleteConversation: (id: string) => void;
  generateAnother: (message: Message) => void;
  loadEarlierMessages: () => void;
  loadMessageConfig: (message: Message) => void;
  openConversations: () => void;
  openFavoritePromptSettings: () => void;
  openSettings: () => void;
  previewImage: (id: string) => void;
  refreshImage: (message: Message, imageId: string) => void;
  removeAttachment: (id: string) => void;
  renameConversation: (id: string) => void;
  retryMessage: (message: Message) => void;
  setEditModeEnabled: (value: boolean) => void;
  setLibraryOpen: (value: boolean) => void;
};

const { actions, header, messages } = defineProps<{
  actions: ChatWorkspaceActions;
  header: ChatWorkspaceHeader;
  messages: ChatWorkspaceMessages;
}>();

const composerState = useComposerStore();
const { selectingEditImageId: selectingImageId } = storeToRefs(composerState);
const generation = useGenerationStore();
const images = useImagesStore();
const settings = useSettingsStore();
// 桌面应用内隐藏「下载桌面版」入口（已在桌面端，再下载无意义；/download 路由在
// webview 内导航也会把应用本身跳走）。
const showDesktopDownloadEntry = !isTauriRuntime();
const isDragActive = ref(false);
const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null);
const showQqModal = ref(false);

/**
 * 打开 Companion 自带的 provider 管理页（凭据 CRUD / 损坏恢复 / 日志）。
 * 阶段零之后，provider 凭据管理迁移到 Companion 自己的 /admin 页面，
 * Web 项目不再承载凭据管理 UI（边界正本清源，见 docs/evolution-roadmap.md 第四章）。
 * server/嵌入态下 Companion 管理页已禁用（多租户管理面在宿主），不跳转。
 * 桌面 Tauri 运行时经 opener 在系统浏览器打开（webview 内 window.open 被拦截）。
 */
function openCompanionAdmin() {
  if (settings.isEmbedded) return
  const base = settings.companionUrl.replace(/\/$/, "");
  void openExternalUrl(`${base}/admin`).catch(() => {});
}
let dragDepth = 0;

function isImageAttached(id: string) {
  return images.activeAttachments.some((image) => image.id === id);
}

async function continueEdit(imageId: string) {
  if (!composerState.editModeEnabled) {
    if (!isImageAttached(imageId)) {
      images.attachImage(imageId);
    }

    await nextTick();
    composerRef.value?.focusComposer();
    return;
  }

  selectingImageId.value = imageId;
}

async function applyMask(maskBlob: Blob) {
  const source = images.imageById(selectingImageId.value);
  if (!source) {
    selectingImageId.value = "";
    return;
  }

  const maskAsset = await images.createMaskAsset(source, maskBlob);
  actions.applyEditSelection(source.id, maskAsset.id);
  selectingImageId.value = "";
  await nextTick();
  composerRef.value?.focusComposer();
}

function closeMaskModal() {
  selectingImageId.value = "";
}

function importFromDrop(event: DragEvent) {
  resetDragState();
  const files = imageFilesFromTransfer(
    event.dataTransfer?.files,
    event.dataTransfer?.items,
  );

  if (!files.length) return;
  images.importImages(files);
}

function handleDragEnter(event: DragEvent) {
  if (!hasImageTransfer(event)) return;
  dragDepth += 1;
  isDragActive.value = true;
}

function handleDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    isDragActive.value = false;
  }
}

function resetDragState() {
  dragDepth = 0;
  isDragActive.value = false;
}

function hasImageTransfer(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  const items = Array.from(event.dataTransfer?.items ?? []);

  return (
    types.includes("Files") &&
    (!items.length || items.some((item) => item.type.startsWith("image/")))
  );
}

function imageFilesFromTransfer(
  fileList?: FileList | null,
  itemList?: DataTransferItemList | null,
) {
  const files = Array.from(fileList ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );

  if (files.length) return files;

  return Array.from(itemList ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
</script>

<template>
  <section
    class="relative flex min-h-0 min-w-0 flex-1 flex-col"
    aria-label="聊天工作区"
    @dragenter.prevent="handleDragEnter"
    @dragleave.prevent="handleDragLeave"
    @dragover.prevent
    @drop.prevent="importFromDrop"
  >
    <div
      v-if="isDragActive"
      class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-white/85 backdrop-blur-sm"
    >
      <div class="rounded-2xl border border-dashed border-gray-400 bg-white px-8 py-6 text-center shadow-xl">
        <div class="text-base font-semibold text-gray-900">松开以上传图片</div>
        <div class="mt-1 text-sm text-gray-500">图片会保存到图片库，并作为下一条消息的引用图</div>
      </div>
    </div>

    <header
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          class="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          type="button"
          @click="actions.openConversations"
        >
          会话
        </button>
        <h1 class="truncate text-base font-semibold text-gray-800">
          {{ header.activeConversation?.title || '新的对话' }}
        </h1>
        <!-- 嵌入态隐藏侧边栏时,会话删/改入口由 header 承载(独立态走侧边栏)。
             仅在有激活会话时显示。点击复用 actions.deleteConversation/
             renameConversation,删除确认弹窗由 conversationsStore 单一负责。 -->
        <template v-if="header.embeddedSidebarHidden && header.activeConversation">
          <button
            v-track="'conversation.rename_clicked'"
            class="shrink-0 cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            type="button"
            aria-label="重命名会话"
            title="重命名会话"
            @click="actions.renameConversation(header.activeConversation!.id)"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            v-track="{ name: 'conversation.delete_clicked', payload: { conversationId: header.activeConversation!.id } }"
            class="shrink-0 cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-600"
            type="button"
            aria-label="删除会话"
            title="删除会话"
            @click="actions.deleteConversation(header.activeConversation!.id)"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </template>
      </div>
      <div class="flex items-center gap-1">
        <span
          v-if="generation.pendingJobCount > 0"
          class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
        >
          正在生成 {{ generation.pendingJobCount }} 张
        </span>
        <button
          v-if="header.companionStatus?.show"
          class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors"
          :class="
            header.companionStatus.online
              ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              : 'text-amber-600 hover:bg-amber-50'
          "
          type="button"
          :title="
            settings.isEmbedded
              ? header.companionStatus.online
                ? 'Companion 在线（server 模式管理页由宿主提供）'
                : 'Companion 离线'
              : header.companionStatus.online
                ? `Companion 在线${header.companionStatus.version ? ' v' + header.companionStatus.version : ''}，点击管理`
                : 'Companion 离线，点击管理'
          "
          @click="openCompanionAdmin"
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            :class="header.companionStatus.online ? 'bg-green-500' : 'bg-amber-400'"
          />
          <span class="hidden sm:inline">
            {{ header.companionStatus.online ? 'Companion' : '离线' }}
          </span>
        </button>
        <a
          v-if="showDesktopDownloadEntry"
          :href="DOWNLOAD_PAGE_URL"
          target="_blank"
          rel="noopener"
          class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          title="下载桌面版（macOS / Windows / Linux）"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span class="hidden sm:inline">桌面版</span>
        </a>
        <button
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          type="button"
          aria-label="QQ 交流群"
          title="QQ 交流群：扫码加群讨论"
          @click="showQqModal = true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6.048 3.323c.022.277-.13.523-.338.55-.21.026-.397-.176-.419-.453s.13-.523.338-.55c.21-.026.397.176.42.453Zm2.265-.24c-.603-.146-.894.256-.936.333-.027.048-.008.117.037.15.045.035.092.025.119-.003.361-.39.751-.172.829-.129l.011.007c.053.024.147.028.193-.098.023-.063.017-.11-.006-.142-.016-.023-.089-.08-.247-.118" />
            <path d="M11.727 6.719c0-.022.01-.375.01-.557 0-3.07-1.45-6.156-5.015-6.156S1.708 3.092 1.708 6.162c0 .182.01.535.01.557l-.72 1.795a26 26 0 0 0-.534 1.508c-.68 2.187-.46 3.093-.292 3.113.36.044 1.401-1.647 1.401-1.647 0 .979.504 2.256 1.594 3.179-.408.126-.907.319-1.228.556-.29.213-.253.43-.201.518.228.386 3.92.246 4.985.126 1.065.12 4.756.26 4.984-.126.052-.088.088-.305-.2-.518-.322-.237-.822-.43-1.23-.557 1.09-.922 1.594-2.2 1.594-3.178 0 0 1.041 1.69 1.401 1.647.168-.02.388-.926-.292-3.113a26 26 0 0 0-.534-1.508l-.72-1.795ZM9.773 5.53a.1.1 0 0 1-.009.096c-.109.159-1.554.943-3.033.943h-.017c-1.48 0-2.925-.784-3.034-.943a.1.1 0 0 1-.018-.055q0-.022.01-.04c.13-.287 1.43-.606 3.042-.606h.017c1.611 0 2.912.319 3.042.605m-4.32-.989c-.483.022-.896-.529-.922-1.229s.344-1.286.828-1.308c.483-.022.896.529.922 1.23.027.7-.344 1.286-.827 1.307Zm2.538 0c-.484-.022-.854-.607-.828-1.308.027-.7.44-1.25.923-1.23.483.023.853.608.827 1.309-.026.7-.439 1.251-.922 1.23ZM2.928 8.99q.32.063.639.117v2.336s1.104.222 2.21.068V9.363q.49.027.937.023h.017c1.117.013 2.474-.136 3.786-.396.097.622.151 1.386.097 2.284-.146 2.45-1.6 3.99-3.846 4.012h-.091c-2.245-.023-3.7-1.562-3.846-4.011-.054-.9 0-1.663.097-2.285" />
          </svg>
        </button>
        <a
          href="https://github.com/honlnk/gpt-image-studio"
          target="_blank"
          rel="noopener noreferrer"
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="GitHub 仓库"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <button
          class="cursor-pointer rounded-lg p-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          aria-label="打开设置"
          type="button"
          @click="actions.openSettings"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          class="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:hidden"
          type="button"
          @click="actions.setLibraryOpen(!header.isLibraryOpen)"
        >
          {{ header.isLibraryOpen ? "隐藏图片库" : "图片库" }}
        </button>
      </div>
    </header>

    <MessageList
      :attached-image-ids="messages.activeAttachmentIds"
      :has-more-history="messages.hasMoreHistory"
      :image-by-id="images.imageById"
      :loading-history="messages.loadingHistory"
      :messages="messages.activeMessages"
      @attach-image="images.attachImage"
      @continue-edit="continueEdit"
      @copy-text="actions.copyText"
      @generate-another="actions.generateAnother"
      @load-earlier="actions.loadEarlierMessages"
      @load-message-config="actions.loadMessageConfig"
      @preview-image="actions.previewImage"
      @refresh-image="actions.refreshImage"
      @retry-message="actions.retryMessage"
    />

    <ChatComposer
      ref="composerRef"
      :is-drag-active="isDragActive"
      @close-all-editors="actions.closeAllEditors"
      @open-favorite-prompt-settings="actions.openFavoritePromptSettings"
      @preview-image="actions.previewImage"
      @remove-attachment="actions.removeAttachment"
      @update:edit-mode-enabled="actions.setEditModeEnabled"
    />

    <EditMaskModal
      :image="selectingImageId ? images.imageById(selectingImageId) : undefined"
      @close="closeMaskModal"
      @apply="applyMask"
    />

    <QqGroupModal v-if="showQqModal" @close="showQqModal = false" />
  </section>
</template>
