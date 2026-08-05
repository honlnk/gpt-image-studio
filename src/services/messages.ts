import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import type { Message } from "../types/studio";
import { timestampFromCreatedAt } from "../shared/dateTime";
import { STORE_NAMES, type ListPageOptions, type ListPageResult, type StudioStorage } from "./storage";
import { listPageWithFallback } from "./storage/inMemoryPage";
import { resolveStorage } from "./storage/resolveStorage";

type StoredMessage = Omit<Message, "generationParams"> & {
  generationParams?: StoredGenerationParams;
};

/** 消息（messages 表）的存储服务。阶段一 PR2 改工厂注入（决策 T1）。 */
export type MessageServices = ReturnType<typeof createMessageServices>;

export function createMessageServices(storage: StudioStorage) {
  return {
    async list() {
      const messages = await storage.list<StoredMessage>(STORE_NAMES.messages);
      return messages.map(normalizeMessage).sort(
        (a, b) => timestampFromCreatedAt(a) - timestampFromCreatedAt(b),
      );
    },
    /**
     * 分页查询某会话的消息（server 模式分页 PR-c）：按 createdAt DESC 取一页
     * （最新在前），展示方自行 reverse 成正序。游标/total 语义见 types.ts。
     */
    async listPageByConversation(
      conversationId: string,
      opts: Omit<ListPageOptions, "conversationId">,
    ): Promise<ListPageResult<Message>> {
      const result = await listPageWithFallback<StoredMessage>(
        storage,
        STORE_NAMES.messages,
        { ...opts, conversationId },
      );
      return { ...result, data: result.data.map(normalizeMessage) };
    },
    /**
     * 取某会话的全部消息（跨页走透）。仅级联删除等确需全量的场景使用，
     * UI 加载一律走 listPageByConversation。
     */
    async listByConversationId(conversationId: string): Promise<Message[]> {
      const all: Message[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 1000; page++) {
        const result = await listPageWithFallback<StoredMessage>(
          storage,
          STORE_NAMES.messages,
          { conversationId, before: cursor, limit: 200 },
        );
        all.push(...result.data.map(normalizeMessage));
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      return all;
    },
    save(message: Message) {
      return storage.put(STORE_NAMES.messages, message);
    },
    remove(id: string) {
      return storage.delete(STORE_NAMES.messages, id);
    },
  };
}

/**
 * 恢复时把 pending 消息归一为 error（从 useStudioRestore 收编，PR-c）。
 * 页面刷新/会话中断后，未完成的生成任务不会继续运行，pending 是死状态。
 * 返回 { normalized, changed }，changed 供调用方持久化回写。
 */
export function normalizeInterruptedMessages(messages: Message[]): {
  normalized: Message[];
  changed: Message[];
} {
  const normalized = messages.map((message) => {
    if (message.status !== "pending") return message;
    return {
      ...message,
      status: "error",
      content: "生成中断，请重试。",
      errorMessage: "页面刷新或会话中断后，未完成的生成任务不会继续运行。",
    } satisfies Message;
  });
  const changed = normalized.filter(
    (message, index) => message.status !== messages[index]?.status,
  );
  return { normalized, changed };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultServices = createMessageServices(resolveStorage());

export async function listMessages() {
  return defaultServices.list();
}

export function saveMessage(message: Message) {
  return defaultServices.save(message);
}

export function deleteMessage(id: string) {
  return defaultServices.remove(id);
}

function normalizeMessage(message: StoredMessage): Message {
  return {
    ...message,
    generationParams: message.generationParams
      ? normalizeGenerationParams(message.generationParams)
      : undefined,
  };
}
