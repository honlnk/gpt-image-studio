<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { formatRelativeTime } from "../../shared/dateTime";
import { useGenerationStore } from "../../stores/generationStore";
import type { ImageAsset, Message } from "../../types/studio";
import ErrorGenerationCard from "./message-parts/ErrorGenerationCard.vue";
import PendingGenerationCard from "./message-parts/PendingGenerationCard.vue";
import ReferencedImageList from "./message-parts/ReferencedImageList.vue";
import ResultImageCard from "./message-parts/ResultImageCard.vue";
import UserMessageActions from "./message-parts/UserMessageActions.vue";

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
const generation = useGenerationStore();
const createdAtLabel = computed(() =>
  formatRelativeTime(props.message.createdAt, props.nowMs),
);
const pendingPreviewUrl = computed(() =>
  generation.getPartialPreviewUrl(props.message.id),
);
const hasImagePanel = computed(
  () =>
    props.message.resultImageIds.length ||
    props.message.status === "pending" ||
    props.message.status === "error",
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

function isImageAttached(id: string) {
  return attachedImageIds.value.has(id);
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

function padTime(value: number) {
  return String(value).padStart(2, "0");
}

function stopPendingTimer() {
  if (!pendingTimer) return;
  window.clearInterval(pendingTimer);
  pendingTimer = null;
}
</script>

<template>
  <div
    :class="[
      'group/message relative',
      message.role === 'user' ? 'mb-9' : 'mb-6',
    ]"
  >
    <UserMessageActions
      v-if="message.role === 'user'"
      :message="message"
      @copy-text="emit('copyText', $event)"
      @load-message-config="emit('loadMessageConfig', $event)"
    />

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

      <ReferencedImageList
        :image-by-id="imageById"
        :image-ids="message.referencedImageIds"
        @attach-image="emit('attachImage', $event)"
      />

      <div v-if="hasImagePanel" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ResultImageCard
          v-for="imageId in message.resultImageIds"
          :key="imageId"
          :image="imageById(imageId)"
          :image-id="imageId"
          :is-attached="isImageAttached(imageId)"
          :message="message"
          @attach-image="emit('attachImage', $event)"
          @continue-edit="emit('continueEdit', $event)"
          @generate-another="emit('generateAnother', $event)"
          @preview-image="emit('previewImage', $event)"
          @refresh-image="
            (message, imageId) => emit('refreshImage', message, imageId)
          "
        />

        <PendingGenerationCard
          v-if="message.status === 'pending'"
          :duration-label="pendingDurationLabel()"
          :preview-url="pendingPreviewUrl"
          :retry-attempt="message.networkRetryAttempt"
        />

        <ErrorGenerationCard
          v-if="message.status === 'error'"
          :message="message"
          @retry-message="emit('retryMessage', $event)"
        />
      </div>
    </article>
  </div>
</template>
