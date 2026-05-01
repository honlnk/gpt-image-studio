import type { Message } from "../types/studio";
import { deleteFromStore, getAllFromStore, putInStore, STORE_NAMES } from "./db";

export async function listMessages() {
  const messages = await getAllFromStore<Message>(STORE_NAMES.messages);

  return messages.sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
}

export function saveMessage(message: Message) {
  return putInStore(STORE_NAMES.messages, message);
}

export function deleteMessage(id: string) {
  return deleteFromStore(STORE_NAMES.messages, id);
}
