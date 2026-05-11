import type { ConversationDraft } from "../types/studio";
import { deleteFromStore, getAllFromStore, getFromStore, putInStore, STORE_NAMES } from "./db";

export function loadConversationDraft(conversationId: string) {
  return getFromStore<ConversationDraft>(
    STORE_NAMES.conversationDrafts,
    conversationId,
  );
}

export function saveConversationDraft(draft: ConversationDraft) {
  return putInStore<ConversationDraft>(STORE_NAMES.conversationDrafts, draft);
}

export function deleteConversationDraft(conversationId: string) {
  return deleteFromStore(STORE_NAMES.conversationDrafts, conversationId);
}

export async function deleteConversationDrafts(conversationIds: string[]) {
  await Promise.all(conversationIds.map((id) => deleteConversationDraft(id)));
}

export function listConversationDrafts() {
  return getAllFromStore<ConversationDraft>(STORE_NAMES.conversationDrafts);
}
