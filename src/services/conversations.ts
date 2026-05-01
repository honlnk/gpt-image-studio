import type { Conversation } from "../types/studio";
import { getAllFromStore, putInStore, putManyInStore, STORE_NAMES } from "./db";

export async function listConversations() {
  const conversations = await getAllFromStore<Conversation>(
    STORE_NAMES.conversations,
  );

  return conversations.sort(
    (a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0),
  );
}

export function saveConversation(conversation: Conversation) {
  return putInStore(STORE_NAMES.conversations, conversation);
}

export function saveConversations(conversations: Conversation[]) {
  return putManyInStore(STORE_NAMES.conversations, conversations);
}
