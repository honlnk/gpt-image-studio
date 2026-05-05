<script setup lang="ts">
import { computed, ref } from "vue";
import type { Conversation } from "../../types/studio";

const props = defineProps<{
  conversations: Conversation[];
  activeConversationId: string;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  createConversation: [];
  deleteConversation: [id: string];
  openSettings: [];
  selectConversation: [id: string];
  "update:isOpen": [value: boolean];
}>();

const searchText = ref("");
const filteredConversations = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  if (!query) return props.conversations;

  return props.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.summary}`.toLowerCase().includes(query),
  );
});
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-20 bg-black/35 md:hidden"
    role="presentation"
    @click="emit('update:isOpen', false)"
  ></div>
  <aside
    :class="[
      'flex w-[260px] shrink-0 flex-col bg-[#171717] text-gray-100 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:transition-transform max-md:duration-200',
      isOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
    ]"
    aria-label="历史会话"
  >
    <div class="flex items-center justify-between px-3 pt-3 pb-1">
      <button
        class="flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-white/10"
        type="button"
        @click="emit('createConversation'); emit('update:isOpen', false)"
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

    <div class="px-3 py-2">
      <label class="sr-only" for="conversationSearch">查找会话</label>
      <input
        id="conversationSearch"
        v-model="searchText"
        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-white/20 focus:bg-white/10"
        placeholder="查找会话..."
        type="search"
      />
    </div>

    <nav class="flex-1 overflow-y-auto px-2 py-1">
      <div
        v-if="!filteredConversations.length"
        class="px-3 py-8 text-center text-sm text-gray-500"
      >
        没有找到会话
      </div>
      <div
        v-for="conversation in filteredConversations"
        :key="conversation.id"
        :class="[
          'group mb-0.5 flex items-center gap-1 rounded-lg pr-1 transition-colors',
          conversation.id === activeConversationId
            ? 'bg-white/10 text-white'
            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
        ]"
      >
        <button
          class="min-w-0 flex-1 cursor-pointer px-3 py-2 text-left text-sm"
          type="button"
          @click="emit('selectConversation', conversation.id); emit('update:isOpen', false)"
        >
          <span class="block truncate">{{ conversation.title }}</span>
        </button>
        <button
          class="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 opacity-0 transition-colors hover:bg-white/10 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
          type="button"
          aria-label="删除会话"
          title="删除会话"
          @click.stop="emit('deleteConversation', conversation.id)"
        >
          删除
        </button>
      </div>
    </nav>

    <div class="border-t border-white/10 p-3">
      <div class="text-xs text-gray-500">GPT Image Studio</div>
    </div>
  </aside>
</template>

<style scoped>
input[type="search"]::-webkit-search-cancel-button {
  cursor: pointer;
}
</style>
