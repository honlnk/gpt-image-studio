import { computed, ref } from "vue";
import {
  deleteConversation as deleteConversationRecord,
  saveConversation,
} from "../../services/conversations";
import { isoTimestamp } from "../../shared/dateTime";
import { formatError } from "../../shared/errors";
import { createId } from "../../shared/id";
import { deleteMessage } from "../../services/messages";
import type { Conversation, Message } from "../../types/studio";
import type { StudioConfirmDialog } from "../feedback";
import type { Ref } from "vue";

type CreateConversationInput = {
  title: string;
  summary: string;
  updatedAt: string;
};

type UseStudioConversationsInput = {
  clearDraft: () => void;
  messages: Ref<Message[]>;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
  requestConfirmation: (input: StudioConfirmDialog) => Promise<boolean>;
};

export function useStudioConversations(input: UseStudioConversationsInput) {
  const conversations = ref<Conversation[]>([]);
  const activeConversationId = ref("");
  let conversationWriteQueue = Promise.resolve();

  const activeConversation = computed(() =>
    conversations.value.find((item) => item.id === activeConversationId.value),
  );
  const activeMessages = computed(() =>
    input.messages.value.filter(
      (message) => message.conversationId === activeConversationId.value,
    ),
  );

  function selectConversation(id: string) {
    activeConversationId.value = id;
  }

  async function deleteConversation(id: string) {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) return;

    const confirmed = await input.requestConfirmation({
      title: "删除会话",
      description: `确定删除会话“${conversation.title}”吗？聊天记录会被移除，图片库中的图片会保留。`,
      confirmLabel: "删除会话",
      tone: "danger",
    });
    if (!confirmed) return;

    const deletedMessages = input.messages.value.filter(
      (message) => message.conversationId === id,
    );
    conversations.value = conversations.value.filter((item) => item.id !== id);
    input.messages.value = input.messages.value.filter(
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
      input.notifySuccess("会话已删除。");
    } catch (error) {
      input.notifyError(`删除会话失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function deleteConversations(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;

    const deletedMessages = input.messages.value.filter((message) =>
      idSet.has(message.conversationId),
    );
    conversations.value = conversations.value.filter(
      (conversation) => !idSet.has(conversation.id),
    );
    input.messages.value = input.messages.value.filter(
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
      input.notifySuccess(`已删除 ${ids.length} 个对话。`);
    } catch (error) {
      input.notifyError(`删除对话失败：${formatError(error)}`);
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

    conversation.title = text.length > 16 ? `${text.slice(0, 16)}...` : text;
    conversation.summary = summary;
    conversation.updatedAt = updatedAt;

    conversations.value = [
      conversation,
      ...conversations.value.filter((item) => item.id !== conversationId),
    ];

    return conversation;
  }

  function persistConversation(conversation: Conversation) {
    const snapshot = toPlainConversation(conversation);
    conversationWriteQueue = conversationWriteQueue
      .catch(input.onStorageError)
      .then(() => saveConversation(snapshot));

    return conversationWriteQueue.catch(input.onStorageError);
  }

  return {
    activeConversation,
    activeConversationId,
    activeMessages,
    conversations,
    createConversation,
    createConversationRecord,
    deleteConversation,
    deleteConversations,
    persistConversation,
    selectConversation,
    updateConversationSummary,
  };
}

function toPlainConversation(conversation: Conversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt,
  };
}
