<script setup lang="ts">
import { useNow } from "../../composables/useNow";
import type { ImageAsset, Message } from "../../types/studio";
import MessageItem from "./MessageItem.vue";

defineProps<{
  attachedImageIds: string[];
  imageById: (id: string) => ImageAsset | undefined;
  messages: Message[];
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  continueEdit: [id: string];
  previewImage: [id: string];
  retryMessage: [message: Message];
}>();

const now = useNow();
</script>

<template>
  <div class="flex-1 overflow-y-auto">
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
        @preview-image="emit('previewImage', $event)"
        @retry-message="emit('retryMessage', $event)"
      />
    </div>
  </div>
</template>
