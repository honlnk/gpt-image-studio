<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../../composables/useNow";
import { formatRelativeTime } from "../../shared/dateTime";
import type { Conversation } from "../../types/studio";

type SortDirection = "asc" | "desc";
type ConversationSortKey = "name" | "time";

const props = defineProps<{
  conversationSortDirection: SortDirection;
  conversationSortKey: ConversationSortKey;
  conversationSortOptions: { key: ConversationSortKey; label: string }[];
  conversations: Conversation[];
  filteredConversations: Conversation[];
  searchText: string;
  selectedConversationIds: Set<string>;
  selectedConversations: Conversation[];
}>();

const emit = defineEmits<{
  clearSelection: [];
  deleteSelected: [];
  selectAll: [];
  setSort: [key: ConversationSortKey];
  toggleSelection: [id: string];
}>();

const now = useNow();
const updatedAtLabels = computed(() =>
  new Map(
    props.filteredConversations.map((conversation) => [
      conversation.id,
      formatRelativeTime(conversation.updatedAt, now.value),
    ]),
  ),
);
</script>

<template>
  <section
    class="mt-5 flex min-h-0 flex-1 flex-col"
    aria-labelledby="batchConversationsTitle"
  >
    <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div>
        <h4
          id="batchConversationsTitle"
          class="text-sm font-semibold text-gray-900"
        >
          对话
        </h4>
        <p class="mt-0.5 text-xs text-gray-500">
          找到 {{ filteredConversations.length }} 个，共
          {{ conversations.length }} 个，已选
          {{ selectedConversations.length }} 个
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-1 text-xs">
        <span class="text-gray-400">排序</span>
        <button
          v-for="option in conversationSortOptions"
          :key="option.key"
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 transition-colors"
          :class="
            conversationSortKey === option.key
              ? 'bg-gray-100 font-medium text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
          "
          type="button"
          @click="emit('setSort', option.key)"
        >
          {{ option.label }}
          <svg
            v-if="conversationSortKey === option.key"
            class="h-3 w-3 transition-transform"
            :class="{ 'rotate-180': conversationSortDirection === 'desc' }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
      <div class="flex shrink-0 gap-1 text-xs">
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          type="button"
          @click="emit('selectAll')"
        >
          全选
        </button>
        <button
          class="cursor-pointer rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          type="button"
          @click="emit('clearSelection')"
        >
          清空
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <article
        v-for="conversation in filteredConversations"
        :key="conversation.id"
        :class="[
          'mb-2 flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
          selectedConversationIds.has(conversation.id)
            ? 'border-gray-900 bg-gray-50 shadow-sm'
            : 'border-gray-200 hover:bg-gray-50',
        ]"
        @click="emit('toggleSelection', conversation.id)"
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
            {{ conversation.summary }} · {{ updatedAtLabels.get(conversation.id) }}
          </p>
        </div>
      </article>
      <div
        v-if="!filteredConversations.length"
        class="rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center"
      >
        <p
          v-if="searchText"
          class="text-sm font-medium text-gray-600"
        >
          没有找到匹配的对话
        </p>
        <p
          v-else
          class="text-sm font-medium text-gray-600"
        >
          还没有可批量处理的对话
        </p>
        <p class="mt-1 text-xs leading-relaxed text-gray-400">
          {{
            searchText
              ? "换一个消息关键词试试。"
              : "新建会话或发送第一条图片生成请求后，这里会显示可批量删除的对话列表。"
          }}
        </p>
      </div>
    </div>

    <div class="mt-3 shrink-0">
      <button
        class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors enabled:cursor-pointer enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
        :disabled="!selectedConversations.length"
        type="button"
        @click="emit('deleteSelected')"
      >
        删除选中对话 ({{ selectedConversations.length }})
      </button>
    </div>
  </section>
</template>
