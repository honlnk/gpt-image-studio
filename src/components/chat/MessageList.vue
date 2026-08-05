<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useNow } from "../../composables/useNow";
import type { ImageAsset, Message } from "../../types/studio";
import ChatEmptyState from "./ChatEmptyState.vue";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  attachedImageIds: string[];
  imageById: (id: string) => ImageAsset | undefined;
  messages: Message[];
  /** 窗口之前还有更早的历史页（server 模式分页 PR-d）。 */
  hasMoreHistory?: boolean;
  /** 更早一页正在加载中（顶部指示 + 滚动触发去重）。 */
  loadingHistory?: boolean;
}>();

const emit = defineEmits<{
  attachImage: [id: string];
  continueEdit: [id: string];
  copyText: [text: string];
  generateAnother: [message: Message];
  loadEarlier: [];
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

// 向上滚动到顶：加载更早一页。store 内部有游标/在飞守卫，这里只按视图条件节流。
function onScroll() {
  const container = scrollContainer.value;
  if (!container) return;
  if (container.scrollTop < 48 && props.hasMoreHistory && !props.loadingHistory) {
    emit("loadEarlier");
  }
}

watch(
  () => props.messages.map((message) => message.id).join("|"),
  (newIds, oldIds) => {
    // flush:sync —— DOM 尚未更新，此刻读到的 scrollHeight/scrollTop 仍是旧布局，
    // 正是 prepend 滚动保持需要的基准值。
    const container = scrollContainer.value;
    const isPrepend = Boolean(
      container &&
        oldIds &&
        newIds.length > oldIds.length &&
        newIds.endsWith(oldIds),
    );
    if (!isPrepend || !container) {
      // 尾部追加 / 窗口整体替换（切会话）：维持原有滚到底行为
      void scrollToBottom();
      return;
    }
    // prepend：保持视口锚定在原来的消息上，而不是被顶部的历史页挤走
    const oldScrollHeight = container.scrollHeight;
    const oldScrollTop = container.scrollTop;
    void nextTick(() => {
      container.scrollTop =
        container.scrollHeight - (oldScrollHeight - oldScrollTop);
    });
  },
  { flush: "sync" },
);
</script>

<template>
  <div ref="scrollContainer" class="flex-1 overflow-y-auto" @scroll="onScroll">
    <ChatEmptyState
      v-if="messages.length === 0"
      @copy-text="emit('copyText', $event)"
    />

    <div v-else class="mx-auto max-w-3xl px-4 py-6">
      <div
        v-if="loadingHistory"
        class="pb-3 text-center text-xs text-gray-400"
      >
        加载更早的消息…
      </div>
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
