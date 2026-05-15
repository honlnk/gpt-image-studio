import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import type { ConversationDraft } from "../types/studio";
import { deleteFromStore, getAllFromStore, getFromStore, putInStore, STORE_NAMES } from "./db";

type StoredConversationDraft = Omit<ConversationDraft, "generationParams"> & {
  generationParams: StoredGenerationParams;
};

export async function loadConversationDraft(conversationId: string) {
  const draft = await getFromStore<StoredConversationDraft>(
    STORE_NAMES.conversationDrafts,
    conversationId,
  );

  return draft ? normalizeConversationDraft(draft) : undefined;
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

export async function listConversationDrafts() {
  const drafts = await getAllFromStore<StoredConversationDraft>(
    STORE_NAMES.conversationDrafts,
  );

  return drafts.map(normalizeConversationDraft);
}

function normalizeConversationDraft(draft: StoredConversationDraft): ConversationDraft {
  return {
    ...draft,
    generationParams: normalizeGenerationParams(draft.generationParams),
  };
}
