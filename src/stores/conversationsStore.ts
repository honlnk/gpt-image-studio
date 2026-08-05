import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ConversationServices,
} from "../services/conversations";
import { normalizeInterruptedMessages, type MessageServices } from "../services/messages";
import { isoTimestamp } from "../shared/dateTime";
import { formatError } from "../shared/errors";
import { createId } from "../shared/id";
import { useFeedbackStore } from "./feedbackStore";
import type { Conversation, Message } from "../types/studio";

/** 分页页大小（server 模式分页 PR-c）。 */
export const CONVERSATIONS_PAGE_SIZE = 50;
export const MESSAGES_PAGE_SIZE = 50;

type CreateConversationInput = {
  title: string;
  summary: string;
  updatedAt: string;
};

type ConversationsStoreContext = {
  /** 阶段一 PR2：存储服务通过 context 注入（决策 T1），store 不再模块级 import service。 */
  services: {
    conversations: ConversationServices;
    messages: MessageServices;
  };
  clearDraft: () => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
};

export const useConversationsStore = defineStore("conversations", () => {
  const conversations = ref<Conversation[]>([]);
  // messages 语义（PR-c）：不是全量表，而是「当前会话的已加载窗口」
  // （正序展示）。切会话由 loadConversationMessages 整体替换；
  // 向上翻页由 loadEarlierMessages 向前 prepend；新生成的消息尾部 push。
  const messages = ref<Message[]>([]);
  const activeConversationId = ref("");
  // ─── 分页状态（server 模式分页 PR-c） ───
  const conversationsNextCursor = ref<string | null>(null);
  const conversationsTotal = ref(0);
  const isLoadingMoreConversations = ref(false);
  /** 消息窗口属于哪个会话 + 该会话向更早翻页的游标。 */
  const messagesWindowConversationId = ref("");
  const messagesNextCursor = ref<string | null>(null);
  const isLoadingEarlierMessages = ref(false);
  /** 快速连续切会话时的竞态守卫：只有最后一次加载允许落地。 */
  let messagesLoadToken = 0;
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

    const deletedMessages = await input.services.messages.listByConversationId(id);
    conversations.value = conversations.value.filter((item) => item.id !== id);
    // 消息窗口里已加载的条目同步清掉（窗口模型下内存只持有当前会话一页，
    // 完整级联删除依赖上面的 listByConversationId 查存储，不依赖内存）
    messages.value = messages.value.filter(
      (message) => message.conversationId !== id,
    );

    if (activeConversationId.value === id) {
      activeConversationId.value = conversations.value[0]?.id ?? "";
      input.clearDraft();
    }

    try {
      await Promise.all([
        input.services.conversations.remove(id),
        ...deletedMessages.map((message) =>
          input.services.messages.remove(message.id),
        ),
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
    // 级联删除的消息清单查存储（窗口模型下内存只有当前会话一页，不能依赖内存 filter）
    const deletedMessages = (
      await Promise.all(
        ids.map((id) => input.services.messages.listByConversationId(id)),
      )
    ).flat();
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
        ...ids.map((id) => input.services.conversations.remove(id)),
        ...deletedMessages.map((message) =>
          input.services.messages.remove(message.id),
        ),
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
      .then(() => input.services.conversations.save(snapshot));

    return conversationWriteQueue.catch(input.onStorageError);
  }

  function getContext() {
    if (!context) {
      throw new Error("Conversations store is not configured.");
    }

    return context;
  }

  // ─── 分页加载（server 模式分页 PR-c） ───

  /** 启动恢复：加载会话第一页（整体替换）。返回本页数据供调用方做 URL/种子校验。 */
  async function loadConversationsFirstPage() {
    const page = await getContext().services.conversations.listPage({
      limit: CONVERSATIONS_PAGE_SIZE,
    });
    conversations.value = page.data;
    conversationsNextCursor.value = page.nextCursor;
    conversationsTotal.value = page.total;
    return page.data;
  }

  /** 侧边栏滚到底：追加下一页会话。 */
  async function loadMoreConversations() {
    const cursor = conversationsNextCursor.value;
    if (!cursor || isLoadingMoreConversations.value) return;
    isLoadingMoreConversations.value = true;
    try {
      const page = await getContext().services.conversations.listPage({
        before: cursor,
        limit: CONVERSATIONS_PAGE_SIZE,
      });
      conversations.value = [...conversations.value, ...page.data];
      conversationsNextCursor.value = page.nextCursor;
      conversationsTotal.value = page.total;
    } catch (error) {
      getContext().onStorageError(error);
    } finally {
      isLoadingMoreConversations.value = false;
    }
  }

  /**
   * 切会话/启动恢复：整体替换消息窗口为该会话最新一页（存储 DESC → 正序展示），
   * 并把中断的 pending 消息归一为 error（页面刷新后生成不会继续）回写持久化。
   * 窗口已是该会话时跳过（ViewModel watch 与 restore 显式加载的去重）。
   */
  async function loadConversationMessages(conversationId: string) {
    if (!conversationId) {
      clearMessagesWindow();
      return;
    }
    if (messagesWindowConversationId.value === conversationId) return;
    const token = ++messagesLoadToken;
    const page = await getContext().services.messages.listPageByConversation(
      conversationId,
      { limit: MESSAGES_PAGE_SIZE },
    );
    if (token !== messagesLoadToken) return; // 已被更新的切换取代，丢弃过期结果
    const { normalized, changed } = normalizeInterruptedMessages(page.data);
    messages.value = [...normalized].reverse();
    messagesWindowConversationId.value = conversationId;
    messagesNextCursor.value = page.nextCursor;
    if (changed.length) {
      void Promise.all(
        changed.map((message) => getContext().services.messages.save(message)),
      ).catch(getContext().onStorageError);
    }
  }

  /** 聊天区向上滚动：向窗口前部 prepend 更早一页。 */
  async function loadEarlierMessages() {
    const cursor = messagesNextCursor.value;
    const conversationId = messagesWindowConversationId.value;
    if (!cursor || !conversationId || isLoadingEarlierMessages.value) return;
    isLoadingEarlierMessages.value = true;
    try {
      const page = await getContext().services.messages.listPageByConversation(
        conversationId,
        { before: cursor, limit: MESSAGES_PAGE_SIZE },
      );
      // 加载期间窗口被切走则丢弃
      if (messagesWindowConversationId.value !== conversationId) return;
      const { normalized, changed } = normalizeInterruptedMessages(page.data);
      messages.value = [...[...normalized].reverse(), ...messages.value];
      messagesNextCursor.value = page.nextCursor;
      if (changed.length) {
        void Promise.all(
          changed.map((message) => getContext().services.messages.save(message)),
        ).catch(getContext().onStorageError);
      }
    } catch (error) {
      getContext().onStorageError(error);
    } finally {
      isLoadingEarlierMessages.value = false;
    }
  }

  /** 清空消息窗口（备份导入等全量重置场景）。 */
  function clearMessagesWindow() {
    messagesLoadToken++;
    messages.value = [];
    messagesWindowConversationId.value = "";
    messagesNextCursor.value = null;
  }

  /** 清空会话列表与分页状态（备份导入等全量重置场景）。 */
  function resetPagination() {
    conversations.value = [];
    conversationsNextCursor.value = null;
    conversationsTotal.value = 0;
    clearMessagesWindow();
  }

  return {
    activeConversation,
    activeConversationId,
    activeMessages,
    conversations,
    conversationsNextCursor,
    conversationsTotal,
    isLoadingEarlierMessages,
    isLoadingMoreConversations,
    messages,
    messagesNextCursor,
    messagesWindowConversationId,
    clearMessagesWindow,
    configureConversationsStore,
    createConversation,
    createConversationRecord,
    deleteConversation,
    deleteConversations,
    loadConversationMessages,
    loadConversationsFirstPage,
    loadEarlierMessages,
    loadMoreConversations,
    persistConversation,
    renameConversation,
    resetPagination,
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
