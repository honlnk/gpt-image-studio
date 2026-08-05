import type { Conversation } from "../types/studio";
import { timestampFromUpdatedAt } from "../shared/dateTime";
import { STORE_NAMES, type ListPageOptions, type ListPageResult, type StudioStorage } from "./storage";
import { listPageWithFallback } from "./storage/inMemoryPage";
import { resolveStorage } from "./storage/resolveStorage";

/**
 * 会话（conversations 表）的存储服务。
 *
 * 阶段一 PR2：改为工厂函数注入（决策 T1）。store 通过 configure 接收
 * createConversationServices(storage) 的返回值；模块级导出保留为
 * 向后兼容入口，委托默认实例（resolveStorage()）。
 *
 * 业务代码不应直接调用模块级导出（PR6 移除），应通过 store 注入。
 */
export type ConversationServices = ReturnType<typeof createConversationServices>;

export function createConversationServices(storage: StudioStorage) {
  return {
    async list() {
      const conversations = await storage.list<Conversation>(
        STORE_NAMES.conversations,
      );
      return conversations.sort(
        (a, b) => timestampFromUpdatedAt(b) - timestampFromUpdatedAt(a),
      );
    },
    /**
     * 分页查询（server 模式分页 PR-c）：按 updatedAt DESC 取一页。
     * 后端未实现 listPage 时回退全量 + 内存分页（listPageWithFallback）。
     */
    listPage(opts: ListPageOptions): Promise<ListPageResult<Conversation>> {
      return listPageWithFallback<Conversation>(storage, STORE_NAMES.conversations, opts);
    },
    /** 按 id 取单个会话。URL 恢复（?c=）指向第一页之外的会话时兜底用。 */
    getById(id: string) {
      return storage.get<Conversation>(STORE_NAMES.conversations, id);
    },
    save(conversation: Conversation) {
      return storage.put(STORE_NAMES.conversations, conversation);
    },
    remove(id: string) {
      return storage.delete(STORE_NAMES.conversations, id);
    },
  };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultServices = createConversationServices(resolveStorage());

export async function listConversations() {
  return defaultServices.list();
}

export function saveConversation(conversation: Conversation) {
  return defaultServices.save(conversation);
}

export function deleteConversation(id: string) {
  return defaultServices.remove(id);
}
