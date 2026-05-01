<script setup lang="ts">
import type { Conversation } from "../../types/studio";

defineProps<{
  conversations: Conversation[];
  activeConversationId: string;
}>();

const emit = defineEmits<{
  createConversation: [];
  openSettings: [];
  selectConversation: [id: string];
}>();
</script>

<template>
  <aside
    class="flex w-[260px] shrink-0 flex-col bg-[#171717] text-gray-100 max-md:hidden"
    aria-label="历史会话"
  >
    <div class="flex items-center justify-between px-3 pt-3 pb-1">
      <button
        class="flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-white/10"
        type="button"
        @click="emit('createConversation')"
      >
        + 新建会话
      </button>
      <button
        class="cursor-pointer rounded-lg p-2 text-sm transition-colors hover:bg-white/10"
        aria-label="打开设置"
        type="button"
        @click="emit('openSettings')"
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
        @click="emit('selectConversation', conversation.id)"
      >
        <span class="block truncate">{{ conversation.title }}</span>
      </button>
    </nav>

    <div class="border-t border-white/10 p-3">
      <div class="text-xs text-gray-500">GPT Image Studio</div>
    </div>
  </aside>
</template>
