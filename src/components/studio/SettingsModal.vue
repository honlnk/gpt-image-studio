<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createZipArchive } from "../../services/zipArchive";
import type { Conversation, ImageAsset } from "../../types/studio";
import ConfirmInputModal from "../ui/ConfirmInputModal.vue";

type SettingsTab = "api" | "backup" | "batch";
type BatchPanel = "images" | "conversations";
type ConfirmAction = "restoreBackup" | "deleteImages" | "deleteConversations";

const props = defineProps<{
  isOpen: boolean;
  initialBatchPanel?: BatchPanel;
  initialTab?: SettingsTab;
  apiKey: string;
  apiBaseUrl: string;
  conversations: Conversation[];
  images: ImageAsset[];
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
const backupInputRef = ref<HTMLInputElement | null>(null);
const pendingBackupFile = ref<File | null>(null);
const confirmAction = ref<ConfirmAction | null>(null);
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

const selectedImages = computed(() =>
  props.images.filter(
    (image) => image.previewUrl && selectedImageIds.value.has(image.id),
  ),
);
const downloadableImages = computed(() =>
  props.images.filter((image) => image.previewUrl),
);
const selectedConversations = computed(() =>
  props.conversations.filter((conversation) =>
    selectedConversationIds.value.has(conversation.id),
  ),
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
    clearSelections();
  },
);

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

function chooseBackupFile() {
  backupInputRef.value?.click();
}

function importBackupFromInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    pendingBackupFile.value = file;
    confirmAction.value = "restoreBackup";
  }
  input.value = "";
}

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
    props.conversations.map((conversation) => conversation.id),
  );
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

function sourceLabel(image: ImageAsset) {
  return image.source === "generated" ? "生成图" : "导入图";
}

function imageSize(image: ImageAsset) {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return fileSize(image);
}

function fileSize(image: ImageAsset) {
  if (!image.sizeBytes) return "未知大小";
  if (image.sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(image.sizeBytes / 1024))} KB`;
  }
  return `${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
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
            <section
              v-if="activeTab === 'api'"
              aria-labelledby="apiSettingsTitle"
            >
              <h3
                id="apiSettingsTitle"
                class="text-base font-semibold text-gray-900"
              >
                接口
              </h3>
              <p class="mt-1 text-sm text-gray-500">
                当前设置会保存到浏览器本地 IndexedDB。
              </p>

              <div
                class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
              >
                API key
                会保存在当前浏览器本地环境。共享电脑或公共环境中请谨慎使用。
              </div>

              <div class="mt-5 space-y-4">
                <div>
                  <label
                    class="mb-1 block text-sm font-medium text-gray-700"
                    for="apiKey"
                    >OpenAI API key</label
                  >
                  <input
                    id="apiKey"
                    :value="apiKey"
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
                    autocomplete="off"
                    placeholder="sk-..."
                    type="password"
                    @input="
                      emit(
                        'update:apiKey',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
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
                    :value="apiBaseUrl"
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
                    placeholder="https://api.openai.com/v1/images"
                    type="url"
                    @input="
                      emit(
                        'update:apiBaseUrl',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                  <a
                    href="https://code.mrzengchn.com/register?aff=HMvx"
                    class="mt-1.5 inline-block cursor-pointer text-xs text-gray-400 transition-colors hover:text-gray-600"
                    target="_blank"
                    rel="noopener"
                    >没有API Key？</a
                  >
                </div>
              </div>
            </section>

            <section
              v-else-if="activeTab === 'backup'"
              aria-labelledby="backupSettingsTitle"
            >
              <h3
                id="backupSettingsTitle"
                class="text-base font-semibold text-gray-900"
              >
                数据备份
              </h3>
              <p class="mt-1 text-sm leading-relaxed text-gray-500">
                导出会话、消息和图片；API key
                不会写入备份。恢复备份会覆盖当前浏览器里的本地数据。
              </p>

              <div class="mt-5 flex flex-wrap gap-2">
                <button
                  class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  type="button"
                  @click="emit('exportBackup')"
                >
                  导出备份
                </button>
                <button
                  class="cursor-pointer rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                  type="button"
                  @click="chooseBackupFile"
                >
                  恢复备份
                </button>
                <input
                  ref="backupInputRef"
                  class="sr-only"
                  type="file"
                  accept=".zip,application/zip"
                  @change="importBackupFromInput"
                />
              </div>
            </section>

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

                <div
                  class="mt-4 grid rounded-lg bg-gray-100 p-1 sm:w-80 sm:grid-cols-2"
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
              </div>

              <section
                v-if="activeBatchPanel === 'images'"
                class="mt-5 flex min-h-0 flex-1 flex-col"
                aria-labelledby="batchImagesTitle"
              >
                <div
                  class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <h4
                      id="batchImagesTitle"
                      class="text-sm font-semibold text-gray-900"
                    >
                      图片
                    </h4>
                    <p class="mt-0.5 text-xs text-gray-500">
                      共 {{ images.length }} 张，已选
                      {{ selectedImages.length }} 张
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-1 text-xs">
                    <button
                      class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                      type="button"
                      @click="selectAllImages"
                    >
                      全选
                    </button>
                    <button
                      class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                      type="button"
                      @click="selectedImageIds = new Set()"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <article
                    v-for="image in images"
                    :key="image.id"
                    :class="[
                      'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition-colors',
                      selectedImageIds.has(image.id)
                        ? 'border-gray-900 bg-gray-50 shadow-sm'
                        : image.previewUrl
                          ? 'border-gray-200 hover:bg-gray-50'
                          : 'border-gray-200 opacity-60',
                    ]"
                    @click="image.previewUrl && toggleImageSelection(image.id)"
                  >
                    <div
                      :class="[
                        'group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400',
                        selectedImageIds.has(image.id)
                          ? 'ring-2 ring-gray-900 ring-offset-1'
                          : '',
                      ]"
                      @click.stop="
                        image.previewUrl && emit('previewImage', image.id)
                      "
                    >
                      <img
                        v-if="image.previewUrl"
                        class="h-full w-full rounded-lg object-cover"
                        :alt="image.name"
                        :src="image.previewUrl"
                      />
                      <span v-else>img</span>
                      <button
                        v-if="image.previewUrl"
                        class="absolute inset-0 flex cursor-pointer items-center justify-center rounded-lg bg-black/45 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                        type="button"
                        @click.stop="emit('previewImage', image.id)"
                      >
                        点击查看
                      </button>
                      <span
                        v-if="selectedImageIds.has(image.id)"
                        class="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white shadow"
                        aria-hidden="true"
                      >
                        <svg
                          class="h-3 w-3"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42 0L3.29 9.224a1 1 0 1 1 1.42-1.408l4.04 4.074 6.54-6.594a1 1 0 0 1 1.414-.006z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </span>
                    </div>
                    <div>
                      <p class="truncate text-sm font-medium text-gray-800">
                        {{ image.name }}
                      </p>
                      <p class="truncate text-xs text-gray-500">
                        {{ sourceLabel(image) }} · {{ image.createdAt }} ·
                        {{ imageSize(image) }}
                      </p>
                    </div>
                  </article>
                  <div
                    v-if="!images.length"
                    class="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center"
                  >
                    <p class="text-sm font-medium text-gray-600">
                      还没有可批量处理的图片
                    </p>
                    <p class="mt-1 text-xs leading-relaxed text-gray-400">
                      生成图片或从输入框导入本地图片后，这里会显示可下载和可删除的图片列表。
                    </p>
                  </div>
                </div>

                <div class="mt-3 flex shrink-0 gap-2">
                  <button
                    class="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
                    :disabled="!selectedImages.length"
                    type="button"
                    @click="downloadSelectedImages"
                  >
                    下载 ZIP ({{ selectedImages.length }})
                  </button>
                  <button
                    class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    :disabled="!selectedImages.length"
                    type="button"
                    @click="requestImageDelete"
                  >
                    删除选中图片 ({{ selectedImages.length }})
                  </button>
                </div>
              </section>

              <section
                v-else
                class="mt-5 flex min-h-0 flex-1 flex-col"
                aria-labelledby="batchConversationsTitle"
              >
                <div
                  class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <h4
                      id="batchConversationsTitle"
                      class="text-sm font-semibold text-gray-900"
                    >
                      对话
                    </h4>
                    <p class="mt-0.5 text-xs text-gray-500">
                      共 {{ conversations.length }} 个，已选
                      {{ selectedConversations.length }} 个
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-1 text-xs">
                    <button
                      class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                      type="button"
                      @click="selectAllConversations"
                    >
                      全选
                    </button>
                    <button
                      class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                      type="button"
                      @click="selectedConversationIds = new Set()"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <article
                    v-for="conversation in conversations"
                    :key="conversation.id"
                    :class="[
                      'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                      selectedConversationIds.has(conversation.id)
                        ? 'border-gray-900 bg-gray-50 shadow-sm'
                        : 'border-gray-200 hover:bg-gray-50',
                    ]"
                    @click="toggleConversationSelection(conversation.id)"
                  >
                    <div
                      :class="[
                        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-semibold text-gray-500',
                        selectedConversationIds.has(conversation.id)
                          ? 'ring-2 ring-gray-900 ring-offset-1'
                          : '',
                      ]"
                    >
                      {{ conversation.title.slice(0, 1) || "会" }}
                      <span
                        v-if="selectedConversationIds.has(conversation.id)"
                        class="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white shadow"
                        aria-hidden="true"
                      >
                        <svg
                          class="h-3 w-3"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42 0L3.29 9.224a1 1 0 1 1 1.42-1.408l4.04 4.074 6.54-6.594a1 1 0 0 1 1.414-.006z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-gray-800">
                        {{ conversation.title }}
                      </p>
                      <p class="truncate text-xs text-gray-500">
                        {{ conversation.summary }} ·
                        {{ conversation.updatedAt }}
                      </p>
                    </div>
                  </article>
                  <div
                    v-if="!conversations.length"
                    class="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center"
                  >
                    <p class="text-sm font-medium text-gray-600">
                      还没有可批量处理的对话
                    </p>
                    <p class="mt-1 text-xs leading-relaxed text-gray-400">
                      新建会话或发送第一条图片生成请求后，这里会显示可批量删除的对话列表。
                    </p>
                  </div>
                </div>

                <div class="mt-3 shrink-0">
                  <button
                    class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    :disabled="!selectedConversations.length"
                    type="button"
                    @click="requestConversationDelete"
                  >
                    删除选中对话 ({{ selectedConversations.length }})
                  </button>
                </div>
              </section>
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
