import { storeToRefs } from "pinia";
import { useConversationsStore } from "../../stores/conversationsStore";
import {
  createConversationServices,
  type ConversationServices,
} from "../../services/conversations";
import {
  createMessageServices,
  type MessageServices,
} from "../../services/messages";
import { resolveStorage } from "../../services/storage/resolveStorage";

type UseStudioConversationsInput = {
  clearDraft: () => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
  /**
   * 阶段一 PR2：存储服务注入。可选——未传时用默认实例（resolveStorage），
   * 保证改造期间行为不变。PR4 在 ViewModel 装配点统一创建并传入。
   */
  services?: {
    conversations: ConversationServices;
    messages: MessageServices;
  };
};

// 模块级默认 service 实例，供未显式注入时使用（PR4 后 ViewModel 统一注入）。
const defaultStorage = resolveStorage();
const defaultServices = {
  conversations: createConversationServices(defaultStorage),
  messages: createMessageServices(defaultStorage),
};

export function useStudioConversations(input: UseStudioConversationsInput) {
  const conversations = useConversationsStore();
  const refs = storeToRefs(conversations);

  conversations.configureConversationsStore({
    services: input.services ?? defaultServices,
    clearDraft: input.clearDraft,
    onStorageError: input.onStorageError,
    refreshStorageUsage: input.refreshStorageUsage,
  });

  return {
    ...refs,
    createConversation: conversations.createConversation,
    createConversationRecord: conversations.createConversationRecord,
    deleteConversation: conversations.deleteConversation,
    deleteConversations: conversations.deleteConversations,
    loadConversationMessages: conversations.loadConversationMessages,
    loadConversationsFirstPage: conversations.loadConversationsFirstPage,
    loadEarlierMessages: conversations.loadEarlierMessages,
    loadMoreConversations: conversations.loadMoreConversations,
    persistConversation: conversations.persistConversation,
    renameConversation: conversations.renameConversation,
    resetPagination: conversations.resetPagination,
    selectConversation: conversations.selectConversation,
    updateConversationSummary: conversations.updateConversationSummary,
  };
}
