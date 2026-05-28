<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useNow } from "../../composables/useNow";
import type { ImageAsset, Message } from "../../types/studio";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  attachedImageIds: string[];
  imageById: (id: string) => ImageAsset | undefined;
  messages: Message[];
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

const now = useNow();
const scrollContainer = ref<HTMLDivElement | null>(null);

async function scrollToBottom() {
  await nextTick();

  requestAnimationFrame(() => {
    const container = scrollContainer.value;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  });
}

onMounted(scrollToBottom);

watch(
  () => props.messages.map((message) => message.id).join("|"),
  () => {
    void scrollToBottom();
  },
  { flush: "post" },
);
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-3xl px-4 py-6">
      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :attached-image-ids="attachedImageIds"
        :image-by-id="imageById"
        :message="message"
        :now-ms="now"
        @attach-image="emit('attachImage', $event)"
        @continue-edit="emit('continueEdit', $event)"
        @copy-text="emit('copyText', $event)"
        @generate-another="emit('generateAnother', $event)"
        @load-message-config="emit('loadMessageConfig', $event)"
        @preview-image="emit('previewImage', $event)"
        @refresh-image="
          (message, imageId) => emit('refreshImage', message, imageId)
        "
        @retry-message="emit('retryMessage', $event)"
      />
    </div>
  </div>
</template>
