<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createZipArchive } from "../../services/zipArchive";
import type { Conversation, ImageAsset, Message } from "../../types/studio";
import ApiSettingsPanel from "../settings/ApiSettingsPanel.vue";
import BackupPanel from "../settings/BackupPanel.vue";
import BatchConversationsPanel from "../settings/BatchConversationsPanel.vue";
import BatchImagesPanel from "../settings/BatchImagesPanel.vue";
import ConfirmInputModal from "../ui/ConfirmInputModal.vue";

type SettingsTab = "api" | "backup" | "batch";
type BatchPanel = "images" | "conversations";
type ConfirmAction = "restoreBackup" | "deleteImages" | "deleteConversations";
type SortDirection = "asc" | "desc";
type ImageSortKey = "name" | "size" | "time";
type ConversationSortKey = "name" | "time";

const props = defineProps<{
  isOpen: boolean;
  initialBatchPanel?: BatchPanel;
  initialTab?: SettingsTab;
  apiKey: string;
  apiBaseUrl: string;
  conversations: Conversation[];
  images: ImageAsset[];
  messages: Message[];
}>();

const emit = defineEmits<{
  close: [];
  deleteConversations: [ids: string[]];
  deleteImages: [ids: string[]];
  exportBackup: [];
  importBackup: [file: File];
  previewImage: [id: string];
  "update:apiKey": [value: string];
  "update:apiBaseUrl": [value: string];
}>();

const activeTab = ref<SettingsTab>("api");
const activeBatchPanel = ref<BatchPanel>("images");
const pendingBackupFile = ref<File | null>(null);
const confirmAction = ref<ConfirmAction | null>(null);
const searchText = ref("");
const imageSortKey = ref<ImageSortKey>("time");
const imageSortDirection = ref<SortDirection>("desc");
const conversationSortKey = ref<ConversationSortKey>("time");
const conversationSortDirection = ref<SortDirection>("desc");
const selectedImageIds = ref<Set<string>>(new Set());
const selectedConversationIds = ref<Set<string>>(new Set());

const tabs: { key: SettingsTab; label: string }[] = [
  { key: "api", label: "接口" },
  { key: "backup", label: "数据备份" },
  { key: "batch", label: "批量操作" },
];
const batchPanels: { key: BatchPanel; label: string }[] = [
  { key: "images", label: "图片" },
  { key: "conversations", label: "对话" },
];
const imageSortOptions: { key: ImageSortKey; label: string }[] = [
  { key: "name", label: "名称" },
  { key: "size", label: "文件" },
  { key: "time", label: "时间" },
];
const conversationSortOptions: { key: ConversationSortKey; label: string }[] = [
  { key: "name", label: "名称" },
  { key: "time", label: "时间" },
];

const normalizedSearchText = computed(() => searchText.value.trim().toLowerCase());
const filteredImages = computed(() => {
  const images = normalizedSearchText.value
    ? props.images.filter((image) =>
        image.name.toLowerCase().includes(normalizedSearchText.value),
      )
    : props.images;

  return [...images].sort(compareImages);
});
const selectedImages = computed(() =>
  filteredImages.value.filter(
    (image) => image.previewUrl && selectedImageIds.value.has(image.id),
  ),
);
const downloadableImages = computed(() =>
  filteredImages.value.filter((image) => image.previewUrl),
);
const messagesByConversationId = computed(() => {
  const grouped = new Map<string, Message[]>();
  props.messages.forEach((message) => {
    const messages = grouped.get(message.conversationId) ?? [];
    messages.push(message);
    grouped.set(message.conversationId, messages);
  });
  return grouped;
});
const filteredConversations = computed(() => {
  const conversations = normalizedSearchText.value
    ? props.conversations.filter((conversation) => {
        const conversationText = [
          conversation.title,
          conversation.summary,
          ...(messagesByConversationId.value.get(conversation.id) ?? []).map(
            (message) => message.content,
          ),
        ]
          .join(" ")
          .toLowerCase();

        return conversationText.includes(normalizedSearchText.value);
      })
    : props.conversations;

  return [...conversations].sort(compareConversations);
});
const selectedConversations = computed(() =>
  filteredConversations.value.filter((conversation) =>
    selectedConversationIds.value.has(conversation.id),
  ),
);
const searchPlaceholder = computed(() =>
  activeBatchPanel.value === "images" ? "搜索图片名称..." : "搜索对话消息...",
);
const confirmState = computed(() => {
  if (confirmAction.value === "restoreBackup") {
    return {
      title: "恢复备份",
      description:
        "恢复备份会覆盖当前浏览器里的所有会话、消息和图片。API key 不会从备份中恢复。",
      confirmText: "我确认恢复备份并覆盖当前数据",
      confirmLabel: "恢复备份",
      warnDataLoss: false,
    };
  }

  if (confirmAction.value === "deleteImages") {
    const count = selectedImages.value.length;
    return {
      title: "删除选中图片",
      description:
        "所有数据仅保存在当前浏览器中，删除后无法通过任何方式找回，请谨慎操作。",
      confirmText: `我确认删除选中的 ${count} 个图片`,
      confirmLabel: "删除图片",
      warnDataLoss: true,
    };
  }

  const count = selectedConversations.value.length;
  return {
    title: "删除选中对话",
    description:
      "所有数据仅保存在当前浏览器中，删除后无法通过任何方式找回，请谨慎操作。",
    confirmText: `我确认删除选中的 ${count} 个对话`,
    confirmLabel: "删除对话",
    warnDataLoss: true,
  };
});

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    activeTab.value = props.initialTab ?? "api";
    activeBatchPanel.value = props.initialBatchPanel ?? "images";
    searchText.value = "";
    clearSelections();
  },
);

watch(activeBatchPanel, () => {
  searchText.value = "";
});

watch(
  () => props.images,
  () => {
    selectedImageIds.value = new Set(
      [...selectedImageIds.value].filter((id) =>
        props.images.some((image) => image.id === id),
      ),
    );
  },
);

watch(
  () => props.conversations,
  () => {
    selectedConversationIds.value = new Set(
      [...selectedConversationIds.value].filter((id) =>
        props.conversations.some((conversation) => conversation.id === id),
      ),
    );
  },
);

function toggleImageSelection(id: string) {
  selectedImageIds.value = toggledSelection(selectedImageIds.value, id);
}

function toggleConversationSelection(id: string) {
  selectedConversationIds.value = toggledSelection(
    selectedConversationIds.value,
    id,
  );
}

function selectAllImages() {
  selectedImageIds.value = new Set(
    downloadableImages.value.map((image) => image.id),
  );
}

function selectAllConversations() {
  selectedConversationIds.value = new Set(
    filteredConversations.value.map((conversation) => conversation.id),
  );
}

function setImageSort(key: ImageSortKey) {
  if (imageSortKey.value === key) {
    imageSortDirection.value = toggleSortDirection(imageSortDirection.value);
    return;
  }

  imageSortKey.value = key;
  imageSortDirection.value = key === "name" ? "asc" : "desc";
}

function setConversationSort(key: ConversationSortKey) {
  if (conversationSortKey.value === key) {
    conversationSortDirection.value = toggleSortDirection(
      conversationSortDirection.value,
    );
    return;
  }

  conversationSortKey.value = key;
  conversationSortDirection.value = key === "name" ? "asc" : "desc";
}

function toggleSortDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

function compareImages(a: ImageAsset, b: ImageAsset) {
  const direction = imageSortDirection.value === "asc" ? 1 : -1;
  let result = 0;

  if (imageSortKey.value === "name") {
    result = compareText(a.name, b.name);
  } else if (imageSortKey.value === "size") {
    result = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
  } else {
    result = (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0);
  }

  return result * direction || compareText(a.name, b.name);
}

function compareConversations(a: Conversation, b: Conversation) {
  const direction = conversationSortDirection.value === "asc" ? 1 : -1;
  const result = conversationSortKey.value === "name"
    ? compareText(a.title, b.title)
    : (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0);

  return result * direction || compareText(a.title, b.title);
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "zh-Hans", {
    numeric: true,
    sensitivity: "base",
  });
}

function clearSelections() {
  selectedImageIds.value = new Set();
  selectedConversationIds.value = new Set();
}

function requestImageDelete() {
  if (!selectedImages.value.length) return;
  confirmAction.value = "deleteImages";
}

function requestConversationDelete() {
  if (!selectedConversations.value.length) return;
  confirmAction.value = "deleteConversations";
}

function requestBackupImport(file: File) {
  pendingBackupFile.value = file;
  confirmAction.value = "restoreBackup";
}

function cancelConfirm() {
  confirmAction.value = null;
  pendingBackupFile.value = null;
}

function confirmPendingAction() {
  if (confirmAction.value === "restoreBackup" && pendingBackupFile.value) {
    emit("importBackup", pendingBackupFile.value);
  }

  if (confirmAction.value === "deleteImages") {
    emit(
      "deleteImages",
      selectedImages.value.map((image) => image.id),
    );
    selectedImageIds.value = new Set();
  }

  if (confirmAction.value === "deleteConversations") {
    emit(
      "deleteConversations",
      selectedConversations.value.map((conversation) => conversation.id),
    );
    selectedConversationIds.value = new Set();
  }

  confirmAction.value = null;
  pendingBackupFile.value = null;
}

async function downloadSelectedImages() {
  if (!selectedImages.value.length) return;

  const entries = await Promise.all(
    selectedImages.value.map(async (image, index) => {
      const response = await fetch(image.previewUrl as string);
      const blob = await response.blob();

      return {
        name: uniqueZipEntryName(imageDownloadName(image), index),
        blob,
      };
    }),
  );
  const zipBlob = await createZipArchive(entries);
  const downloadUrl = URL.createObjectURL(zipBlob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `gpt-image-studio-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

function toggledSelection(selection: Set<string>, id: string) {
  const nextSelection = new Set(selection);
  if (nextSelection.has(id)) {
    nextSelection.delete(id);
  } else {
    nextSelection.add(id);
  }
  return nextSelection;
}

function imageExtension(image: ImageAsset) {
  if (image.mimeType === "image/jpeg") return "jpeg";
  if (image.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image: ImageAsset) {
  return `${image.name || "image"}.${imageExtension(image)}`;
}

function uniqueZipEntryName(filename: string, index: number) {
  if (index === 0) return filename;

  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return `${filename}-${index + 1}`;
  return `${filename.slice(0, dotIndex)}-${index + 1}${filename.slice(dotIndex)}`;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3"
      role="presentation"
      @click.self="emit('close')"
    >
      <section
        aria-labelledby="settingsTitle"
        aria-modal="true"
        class="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
      >
        <div
          class="flex items-start justify-between border-b border-gray-200 px-5 py-4"
        >
          <div>
            <h2 id="settingsTitle" class="text-lg font-semibold text-gray-900">
              设置
            </h2>
          </div>
          <button
            class="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭设置"
            type="button"
            @click="emit('close')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            class="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 p-2 md:w-44 md:flex-col md:border-r md:border-b-0"
            aria-label="设置分类"
          >
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="shrink-0 cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
              :class="
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:bg-white hover:text-gray-800'
              "
              type="button"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>

          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
            <ApiSettingsPanel
              v-if="activeTab === 'api'"
              :api-base-url="apiBaseUrl"
              :api-key="apiKey"
              @update:api-base-url="emit('update:apiBaseUrl', $event)"
              @update:api-key="emit('update:apiKey', $event)"
            />

            <BackupPanel
              v-else-if="activeTab === 'backup'"
              @export-backup="emit('exportBackup')"
              @import-backup-request="requestBackupImport"
            />

            <section
              v-else
              aria-labelledby="batchSettingsTitle"
              class="flex min-h-0 flex-1 flex-col"
            >
              <div class="shrink-0">
                <h3
                  id="batchSettingsTitle"
                  class="text-base font-semibold text-gray-900"
                >
                  批量操作
                </h3>

                <div class="mt-4 flex flex-col gap-2 sm:flex-row">
                  <div
                    class="grid rounded-lg bg-gray-100 p-1 sm:w-80 sm:grid-cols-2"
                  >
                    <button
                      v-for="panel in batchPanels"
                      :key="panel.key"
                      class="cursor-pointer rounded-md px-2 py-1 text-sm font-medium transition-colors"
                      :class="
                        activeBatchPanel === panel.key
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-800'
                      "
                      type="button"
                      @click="activeBatchPanel = panel.key"
                    >
                      {{ panel.label }}
                    </button>
                  </div>

                  <div class="relative min-w-0 flex-1">
                    <svg
                      class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                      v-model="searchText"
                      class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400"
                      :placeholder="searchPlaceholder"
                      type="text"
                    />
                    <button
                      v-if="searchText"
                      class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      aria-label="清空搜索"
                      type="button"
                      @click="searchText = ''"
                    >
                      <svg
                        class="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <BatchImagesPanel
                v-if="activeBatchPanel === 'images'"
                :filtered-images="filteredImages"
                :image-sort-direction="imageSortDirection"
                :image-sort-key="imageSortKey"
                :image-sort-options="imageSortOptions"
                :images="images"
                :search-text="searchText"
                :selected-image-ids="selectedImageIds"
                :selected-images="selectedImages"
                @clear-selection="selectedImageIds = new Set()"
                @delete-selected="requestImageDelete"
                @download-selected="downloadSelectedImages"
                @preview-image="emit('previewImage', $event)"
                @select-all="selectAllImages"
                @set-sort="setImageSort"
                @toggle-selection="toggleImageSelection"
              />

              <BatchConversationsPanel
                v-else
                :conversation-sort-direction="conversationSortDirection"
                :conversation-sort-key="conversationSortKey"
                :conversation-sort-options="conversationSortOptions"
                :conversations="conversations"
                :filtered-conversations="filteredConversations"
                :search-text="searchText"
                :selected-conversation-ids="selectedConversationIds"
                :selected-conversations="selectedConversations"
                @clear-selection="selectedConversationIds = new Set()"
                @delete-selected="requestConversationDelete"
                @select-all="selectAllConversations"
                @set-sort="setConversationSort"
                @toggle-selection="toggleConversationSelection"
              />
            </section>
          </div>
        </div>

        <div class="flex justify-end border-t border-gray-200 px-5 py-4">
          <button
            class="cursor-pointer rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            type="button"
            @click="emit('close')"
          >
            完成
          </button>
        </div>
      </section>
    </div>
  </Teleport>

  <ConfirmInputModal
    :confirm-label="confirmState.confirmLabel"
    :confirm-text="confirmState.confirmText"
    :description="confirmState.description"
    :is-open="Boolean(confirmAction)"
    :title="confirmState.title"
    @cancel="cancelConfirm"
    @confirm="confirmPendingAction"
  >
    <template v-if="confirmState.warnDataLoss" #description>
      所有数据仅保存在当前浏览器中，删除后<strong class="font-bold text-red-600"
        >无法通过任何方式找回</strong
      >，请谨慎操作。
    </template>
  </ConfirmInputModal>
</template>
