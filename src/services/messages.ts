import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import type { Message } from "../types/studio";
import { timestampFromCreatedAt } from "../shared/dateTime";
import { STORE_NAMES, type StudioStorage } from "./storage";
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
    save(message: Message) {
      return storage.put(STORE_NAMES.messages, message);
    },
    remove(id: string) {
      return storage.delete(STORE_NAMES.messages, id);
    },
  };
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
