import { storeToRefs } from "pinia";
import { useConversationsStore } from "../../stores/conversationsStore";

type UseStudioConversationsInput = {
  clearDraft: () => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
};

export function useStudioConversations(input: UseStudioConversationsInput) {
  const conversations = useConversationsStore();
  const refs = storeToRefs(conversations);

  conversations.configureConversationsStore(input);

  return {
    ...refs,
    createConversation: conversations.createConversation,
    createConversationRecord: conversations.createConversationRecord,
    deleteConversation: conversations.deleteConversation,
    deleteConversations: conversations.deleteConversations,
    persistConversation: conversations.persistConversation,
    renameConversation: conversations.renameConversation,
    selectConversation: conversations.selectConversation,
    updateConversationSummary: conversations.updateConversationSummary,
  };
}
