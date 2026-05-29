<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { formatRelativeTime } from "../../shared/dateTime";
import type { ImageAsset, Message } from "../../types/studio";
import Tooltip from "../ui/Tooltip.vue";

const props = defineProps<{
  attachedImageIds: string[];
  imageById: (id: string) => ImageAsset | undefined;
  message: Message;
  nowMs: number;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  continueEdit: [id: string];
  copyText: [text: string];
  generateAnother: [message: Message];
  loadMessageConfig: [message: Message];
  previewImage: [id: string];
  refreshImage: [message: Message, imageId: string];
  retryMessage: [message: Message];
}>();

const attachedImageIds = computed(() => new Set(props.attachedImageIds));
const createdAtLabel = computed(() =>
  formatRelativeTime(props.message.createdAt, props.nowMs),
);
const pendingNowMs = ref(Date.now());
let pendingTimer: number | null = null;

watch(
  () => props.message.status,
  (status) => {
    if (status === "pending") {
      pendingNowMs.value = Date.now();
      if (!pendingTimer) {
        pendingTimer = window.setInterval(() => {
          pendingNowMs.value = Date.now();
        }, 100);
      }
      return;
    }

    stopPendingTimer();
  },
  { immediate: true },
);

onUnmounted(stopPendingTimer);

function imageExtension(image?: ImageAsset) {
  if (image?.mimeType === "image/jpeg") return "jpeg";
  if (image?.mimeType === "image/webp") return "webp";
  return "png";
}

function imageDownloadName(image?: ImageAsset) {
  return `${image?.name || "image"}.${imageExtension(image)}`;
}

function isImageAttached(id: string) {
  return attachedImageIds.value.has(id);
}

function attachActionLabel(id: string) {
  if (!props.imageById(id)) return "不可引用";
  return isImageAttached(id) ? "已引用" : "加入引用";
}

function durationLabel(milliseconds?: number) {
  if (milliseconds === undefined) return "耗时未知";
  if (milliseconds < 1000) return `${milliseconds}ms`;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function pendingDurationLabel() {
  const startedAtMs = new Date(
    props.message.generationStartedAt ?? props.message.createdAt,
  ).getTime();
  const elapsedMs = Number.isFinite(startedAtMs)
    ? Math.max(0, pendingNowMs.value - startedAtMs)
    : 0;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`;
  }

  const centiseconds = Math.floor((elapsedMs % 1000) / 10);
  return `${padTime(minutes)}:${padTime(seconds)}:${padTime(centiseconds)}`;
}

function errorMessageText() {
  return messageErrorText(props.message);
}

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function stopPendingTimer() {
  if (!pendingTimer) return;
  window.clearInterval(pendingTimer);
  pendingTimer = null;
}

function messageErrorText(message: Message) {
  return message.errorMessage || "请重试这个图片卡片。";
}
</script>

<template>
  <div
    :class="[
      'group/message relative',
      message.role === 'user' ? 'mb-9' : 'mb-6',
    ]"
  >
    <div
      v-if="message.role === 'user'"
      class="absolute right-5 top-full z-10 mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100"
    >
      <Tooltip text="复制文本" preferred-placement="top">
        <button
          class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="复制文本"
          type="button"
          @click="emit('copyText', message.content)"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip text="加载到输入面板" preferred-placement="top">
        <button
          class="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="加载到输入面板"
          type="button"
          @click="emit('loadMessageConfig', message)"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6h9" />
            <path d="M17 6h3" />
            <circle cx="15" cy="6" r="2" />
            <path d="M4 12h3" />
            <path d="M11 12h9" />
            <circle cx="9" cy="12" r="2" />
            <path d="M4 18h11" />
            <path d="M19 18h1" />
            <circle cx="17" cy="18" r="2" />
          </svg>
        </button>
      </Tooltip>
    </div>

    <article
      :class="[
        'rounded-2xl px-5 py-4',
        message.role === 'user' ? 'bg-gray-50' : '',
      ]"
    >
      <div class="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
        <span class="font-semibold text-gray-700">
          {{ message.role === "user" ? "你" : "Image Studio" }}
        </span>
        <span>{{ createdAtLabel }}</span>
      </div>

      <p class="text-[15px] leading-relaxed text-gray-800">
        {{ message.content }}
      </p>

      <div
        v-if="message.referencedImageIds.length"
        class="mt-3 flex flex-wrap gap-2"
      >
        <button
          v-for="imageId in message.referencedImageIds"
          :key="imageId"
          :class="[
            'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
            imageById(imageId)
              ? 'cursor-pointer border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              : 'cursor-not-allowed border-dashed border-gray-300 bg-gray-50 text-gray-400',
          ]"
          type="button"
          :disabled="!imageById(imageId)"
          @click="imageById(imageId) && emit('attachImage', imageId)"
        >
          {{ imageById(imageId)?.name || "图片已删除，无法显示" }}
        </button>
      </div>

      <div
        v-if="
          message.resultImageIds.length ||
          message.status === 'pending' ||
          message.status === 'error'
        "
        class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <figure
          v-for="imageId in message.resultImageIds"
          :key="imageId"
          class="overflow-hidden rounded-xl border border-gray-200"
        >
          <div
            class="group relative flex h-48 items-center justify-center bg-gray-100 text-sm text-gray-400"
          >
            <span
              v-if="imageById(imageId)?.editSourceImageId"
              class="absolute left-2 top-2 z-10 rounded bg-black px-1.5 py-0.5 text-[11px] font-medium text-white"
            >
              已编辑
            </span>
            <button
              v-if="imageById(imageId)?.previewUrl"
              class="h-full w-full cursor-pointer"
              type="button"
              @click="emit('previewImage', imageId)"
            >
              <img
                class="h-full w-full object-contain"
                :alt="imageById(imageId)?.name"
                :src="imageById(imageId)?.previewUrl"
              />
              <span
                class="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                点击查看
              </span>
            </button>
            <div
              v-else
              class="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-gray-300 bg-gray-50 px-4 text-center"
            >
              <span class="text-sm font-medium text-gray-500">图片已删除</span>
              <span class="text-xs text-gray-400">
                这张图片已从图片库移除，无法显示预览
              </span>
            </div>
          </div>
          <figcaption class="px-3 py-2">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center justify-between gap-3">
                <div class="truncate text-sm font-medium">
                  {{ imageById(imageId)?.name || "图片已删除" }}
                </div>
                <div class="shrink-0 text-xs text-gray-400">
                  生成耗时：{{ durationLabel(imageById(imageId)?.generationDurationMs) }}
                </div>
              </div>
              <div class="truncate text-xs text-gray-500">
                {{ imageById(imageId)?.prompt || "原图片资产已从图片库中删除" }}
              </div>
            </div>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button
                class="cursor-pointer rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800"
                type="button"
                :disabled="!imageById(imageId)"
                :class="
                  !imageById(imageId)
                    ? 'cursor-not-allowed opacity-30 hover:bg-black'
                    : ''
                "
                @click="emit('continueEdit', imageId)"
              >
                继续编辑
              </button>
              <div class="flex shrink-0 items-center gap-1">
                <Tooltip :text="attachActionLabel(imageId)" preferred-placement="top">
                  <button
                    :class="[
                      'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                      isImageAttached(imageId)
                        ? 'bg-gray-100 text-gray-400'
                        : 'cursor-pointer text-gray-600 hover:bg-gray-100',
                    ]"
                    type="button"
                    :disabled="!imageById(imageId)"
                    :aria-label="attachActionLabel(imageId)"
                    @click="emit('attachImage', imageId)"
                  >
                    <svg
                      v-if="isImageAttached(imageId)"
                      class="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <svg
                      v-else
                      class="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip text="再次生成" preferred-placement="top">
                  <button
                    class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                    type="button"
                    :disabled="!imageById(imageId) || message.status === 'pending'"
                    aria-label="再次生成"
                    @click="emit('generateAnother', message)"
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
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip text="刷新" preferred-placement="top">
                  <button
                    class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                    type="button"
                    :disabled="!imageById(imageId) || message.status === 'pending'"
                    aria-label="刷新"
                    @click="emit('refreshImage', message, imageId)"
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
                      <path d="M17 1l4 4-4 4" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <path d="M7 23l-4-4 4-4" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip text="下载" preferred-placement="top">
                  <a
                    v-if="imageById(imageId)?.previewUrl"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100"
                    :download="imageDownloadName(imageById(imageId))"
                    :href="imageById(imageId)?.previewUrl"
                    aria-label="下载"
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
                      <path d="M7 10l5 5 5-5" />
                      <path d="M12 15V3" />
                    </svg>
                  </a>
                </Tooltip>
              </div>
            </div>
          </figcaption>
        </figure>

        <figure
          v-if="message.status === 'pending'"
          class="generation-skeleton-card overflow-hidden rounded-xl border border-gray-200 bg-white"
          aria-label="图片生成中"
        >
          <div
            class="generation-skeleton-media flex h-48 items-center justify-center bg-gray-50 text-gray-300"
          >
            <div
              class="generation-orbit flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm"
            >
              <span class="h-2 w-2 rounded-full bg-gray-300"></span>
            </div>
            <div
              class="generation-duration-badge absolute left-1/2 top-[66%] z-[1] -translate-x-1/2 rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-xs font-medium text-gray-500 shadow-sm backdrop-blur"
            >
              正在生成：{{ pendingDurationLabel() }}
            </div>
            <div
              v-if="message.networkRetryAttempt"
              class="absolute right-3 top-3 z-[1] rounded-lg border border-blue-200 bg-white/95 px-2.5 py-1 text-xs font-medium text-blue-600 shadow-sm backdrop-blur"
            >
              正在重试第 {{ message.networkRetryAttempt }} 次
            </div>
          </div>
          <figcaption class="px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <div class="generation-skeleton-line h-4 w-20 rounded"></div>
              <div class="generation-skeleton-line h-3 w-24 rounded"></div>
            </div>
            <div class="generation-skeleton-line mt-2 h-3 w-28 rounded"></div>
            <div class="mt-3 flex items-center justify-between gap-2">
              <div class="generation-skeleton-line h-7 w-16 rounded-lg"></div>
              <div class="flex items-center gap-2">
                <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
                <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
                <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
                <div class="generation-skeleton-line h-6 w-6 rounded-md"></div>
              </div>
            </div>
          </figcaption>
        </figure>

        <figure
          v-if="message.status === 'error'"
          class="overflow-hidden rounded-xl border border-red-100 bg-white"
          aria-label="图片生成失败"
        >
          <div
            class="flex h-48 flex-col items-center justify-center gap-3 bg-red-50/60 px-6 text-center"
          >
            <div
              class="flex h-11 w-11 items-center justify-center rounded-full border border-red-100 bg-white text-red-500 shadow-sm"
            >
              <svg
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <circle cx="12" cy="12" r="10" />
              </svg>
            </div>
            <div>
              <div class="text-sm font-medium text-red-700">生成中断</div>
              <Tooltip
                :text="errorMessageText()"
                preferred-placement="top"
                multiline
                :delay="1000"
                :hide-delay="500"
              >
                <div class="mt-1 line-clamp-2 text-xs leading-relaxed text-red-500">
                  {{ errorMessageText() }}
                </div>
              </Tooltip>
            </div>
          </div>
          <figcaption class="px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">未生成图片</div>
                <Tooltip
                  :text="errorMessageText()"
                  preferred-placement="top"
                  multiline
                  :delay="1000"
                  :hide-delay="500"
                >
                  <div class="truncate text-xs text-gray-500">
                    生成失败：{{ errorMessageText() }}
                  </div>
                </Tooltip>
              </div>
              <button
                class="shrink-0 cursor-pointer rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                type="button"
                @click="emit('retryMessage', message)"
              >
                重试
              </button>
            </div>
          </figcaption>
        </figure>
      </div>
    </article>
  </div>
</template>

<style scoped>
.generation-skeleton-card {
  animation: generation-card-rise 0.28s ease-out both;
}

.generation-skeleton-media {
  position: relative;
  overflow: hidden;
}

.generation-skeleton-media::before,
.generation-skeleton-line::before {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.76),
    transparent
  );
  animation: generation-shimmer 1.75s ease-in-out infinite;
}

.generation-skeleton-media::after {
  content: "";
  position: absolute;
  inset: 18px;
  border-radius: 9999px;
  background:
    radial-gradient(circle at center, rgba(255, 255, 255, 0.9), transparent 34%),
    conic-gradient(
      from 90deg,
      transparent,
      rgba(156, 163, 175, 0.22),
      transparent 42%
    );
  filter: blur(18px);
  opacity: 0.8;
  animation: generation-glow 2.8s ease-in-out infinite;
}

.generation-orbit {
  position: relative;
  z-index: 1;
  animation: generation-orbit 1.45s linear infinite;
}

.generation-orbit::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border: 2px solid transparent;
  border-top-color: rgba(75, 85, 99, 0.62);
  border-right-color: rgba(75, 85, 99, 0.18);
}

.generation-skeleton-line {
  position: relative;
  overflow: hidden;
  background: rgb(243, 244, 246);
}

@keyframes generation-card-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes generation-shimmer {
  0% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(120%);
  }
}

@keyframes generation-glow {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.5;
  }

  50% {
    transform: scale(1.04);
    opacity: 0.9;
  }
}

@keyframes generation-orbit {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .generation-skeleton-card,
  .generation-skeleton-media::before,
  .generation-skeleton-media::after,
  .generation-skeleton-line::before,
  .generation-orbit {
    animation: none;
  }
}
</style>
