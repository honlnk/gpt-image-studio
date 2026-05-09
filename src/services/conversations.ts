import type { Conversation } from "../types/studio";
import { timestampFromUpdatedAt } from "../shared/dateTime";
import { deleteFromStore, getAllFromStore, putInStore, STORE_NAMES } from "./db";

export async function listConversations() {
  const conversations = await getAllFromStore<Conversation>(
    STORE_NAMES.conversations,
  );

  return conversations.sort(
    (a, b) => timestampFromUpdatedAt(b) - timestampFromUpdatedAt(a),
  );
}

export function saveConversation(conversation: Conversation) {
  return putInStore(STORE_NAMES.conversations, conversation);
}

export function deleteConversation(id: string) {
  return deleteFromStore(STORE_NAMES.conversations, id);
}
