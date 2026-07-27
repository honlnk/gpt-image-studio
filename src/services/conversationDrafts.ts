import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import type { ConversationDraft } from "../types/studio";
import { STORE_NAMES, type StudioStorage } from "./storage";
import { resolveStorage } from "./storage/resolveStorage";

type StoredConversationDraft = Omit<ConversationDraft, "generationParams"> & {
  generationParams: StoredGenerationParams;
};

/** 会话草稿（conversationDrafts 表）的存储服务。阶段一 PR2 改工厂注入（决策 T1）。 */
export type ConversationDraftServices = ReturnType<
  typeof createConversationDraftServices
>;

export function createConversationDraftServices(storage: StudioStorage) {
  const services = {
    async load(conversationId: string) {
      const draft = await storage.get<StoredConversationDraft>(
        STORE_NAMES.conversationDrafts,
        conversationId,
      );
      return draft ? normalizeConversationDraft(draft) : undefined;
    },
    save(draft: ConversationDraft) {
      return storage.put<ConversationDraft>(
        STORE_NAMES.conversationDrafts,
        draft,
      );
    },
    remove(conversationId: string) {
      return storage.delete(STORE_NAMES.conversationDrafts, conversationId);
    },
    async removeMany(conversationIds: string[]) {
      await Promise.all(conversationIds.map((id) => services.remove(id)));
    },
    async list() {
      const drafts = await storage.list<StoredConversationDraft>(
        STORE_NAMES.conversationDrafts,
      );
      return drafts.map(normalizeConversationDraft);
    },
  };
  return services;
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultServices = createConversationDraftServices(resolveStorage());

export async function loadConversationDraft(conversationId: string) {
  return defaultServices.load(conversationId);
}

export function saveConversationDraft(draft: ConversationDraft) {
  return defaultServices.save(draft);
}

export function deleteConversationDraft(conversationId: string) {
  return defaultServices.remove(conversationId);
}

export async function deleteConversationDrafts(conversationIds: string[]) {
  return defaultServices.removeMany(conversationIds);
}

export async function listConversationDrafts() {
  return defaultServices.list();
}

function normalizeConversationDraft(
  draft: StoredConversationDraft,
): ConversationDraft {
  return {
    ...draft,
    generationParams: normalizeGenerationParams(draft.generationParams),
  };
}
