import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  deleteConversation as deleteConversationRecord,
  saveConversation,
} from "../services/conversations";
import { deleteMessage } from "../services/messages";
import { isoTimestamp } from "../shared/dateTime";
import { formatError } from "../shared/errors";
import { createId } from "../shared/id";
import { useFeedbackStore } from "./feedbackStore";
import type { Conversation, Message } from "../types/studio";

type CreateConversationInput = {
  title: string;
  summary: string;
  updatedAt: string;
};

type ConversationsStoreContext = {
  clearDraft: () => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
};

export const useConversationsStore = defineStore("conversations", () => {
  const conversations = ref<Conversation[]>([]);
  const messages = ref<Message[]>([]);
  const activeConversationId = ref("");
  let conversationWriteQueue = Promise.resolve();
  let context: ConversationsStoreContext | null = null;

  const activeConversation = computed(() =>
    conversations.value.find((item) => item.id === activeConversationId.value),
  );
  const activeMessages = computed(() =>
    messages.value.filter(
      (message) => message.conversationId === activeConversationId.value,
    ),
  );

  function configureConversationsStore(nextContext: ConversationsStoreContext) {
    context = nextContext;
  }

  function selectConversation(id: string) {
    activeConversationId.value = id;
  }

  async function deleteConversation(id: string) {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) return;

    const input = getContext();
    const feedback = useFeedbackStore();
    const confirmed = await feedback.requestConfirmation({
      title: "删除会话",
      description: `确定删除会话“${conversation.title}”吗？聊天记录会被移除，图片库中的图片会保留。`,
      confirmLabel: "删除会话",
      tone: "danger",
    });
    if (!confirmed) return;

    const deletedMessages = messages.value.filter(
      (message) => message.conversationId === id,
    );
    conversations.value = conversations.value.filter((item) => item.id !== id);
    messages.value = messages.value.filter(
      (message) => message.conversationId !== id,
    );

    if (activeConversationId.value === id) {
      activeConversationId.value = conversations.value[0]?.id ?? "";
      input.clearDraft();
    }

    try {
      await Promise.all([
        deleteConversationRecord(id),
        ...deletedMessages.map((message) => deleteMessage(message.id)),
      ]);
      await input.refreshStorageUsage();
      feedback.notifySuccess("会话已删除。");
    } catch (error) {
      feedback.notifyError(`删除会话失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function deleteConversations(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;

    const input = getContext();
    const feedback = useFeedbackStore();
    const deletedMessages = messages.value.filter((message) =>
      idSet.has(message.conversationId),
    );
    conversations.value = conversations.value.filter(
      (conversation) => !idSet.has(conversation.id),
    );
    messages.value = messages.value.filter(
      (message) => !idSet.has(message.conversationId),
    );

    if (idSet.has(activeConversationId.value)) {
      activeConversationId.value = conversations.value[0]?.id ?? "";
      input.clearDraft();
    }

    try {
      await Promise.all([
        ...ids.map((id) => deleteConversationRecord(id)),
        ...deletedMessages.map((message) => deleteMessage(message.id)),
      ]);
      await input.refreshStorageUsage();
      feedback.notifySuccess(`已删除 ${ids.length} 个对话。`);
    } catch (error) {
      feedback.notifyError(`删除对话失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function createConversation() {
    const conversation = await createConversationRecord({
      title: "新的图片创作",
      summary: "尚未开始",
      updatedAt: isoTimestamp(),
    });
    activeConversationId.value = conversation.id;
  }

  async function createConversationRecord(inputValue: CreateConversationInput) {
    const id = createId("c");
    const conversation: Conversation = {
      id,
      title: inputValue.title,
      summary: inputValue.summary,
      isTitleManuallySet: false,
      createdAt: inputValue.updatedAt,
      updatedAt: inputValue.updatedAt,
    };

    conversations.value.unshift(conversation);
    activeConversationId.value = id;
    await persistConversation(conversation);
    return conversation;
  }

  function updateConversationSummary(
    conversationId: string,
    text: string,
    summary: string,
    updatedAt = isoTimestamp(),
  ) {
    const conversation = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return null;

    if (!conversation.isTitleManuallySet) {
      conversation.title = text.length > 16 ? `${text.slice(0, 16)}...` : text;
    }
    conversation.summary = summary;
    conversation.updatedAt = updatedAt;

    conversations.value = [
      conversation,
      ...conversations.value.filter((item) => item.id !== conversationId),
    ];

    return conversation;
  }

  async function renameConversation(id: string, nextTitle: string) {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) return false;

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return false;

    conversation.title = trimmedTitle;
    conversation.isTitleManuallySet = true;
    conversation.updatedAt = isoTimestamp();
    conversations.value = [
      conversation,
      ...conversations.value.filter((item) => item.id !== id),
    ];
    await persistConversation(conversation);
    return true;
  }

  function persistConversation(conversation: Conversation) {
    const input = getContext();
    const snapshot = toPlainConversation(conversation);
    conversationWriteQueue = conversationWriteQueue
      .catch(input.onStorageError)
      .then(() => saveConversation(snapshot));

    return conversationWriteQueue.catch(input.onStorageError);
  }

  function getContext() {
    if (!context) {
      throw new Error("Conversations store is not configured.");
    }

    return context;
  }

  return {
    activeConversation,
    activeConversationId,
    activeMessages,
    conversations,
    messages,
    configureConversationsStore,
    createConversation,
    createConversationRecord,
    deleteConversation,
    deleteConversations,
    persistConversation,
    renameConversation,
    selectConversation,
    updateConversationSummary,
  };
});

function toPlainConversation(conversation: Conversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    isTitleManuallySet: conversation.isTitleManuallySet,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt,
  };
}
