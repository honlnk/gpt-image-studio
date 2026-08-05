import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  CONVERSATIONS_PAGE_SIZE,
  MESSAGES_PAGE_SIZE,
  useConversationsStore,
} from "./conversationsStore";
import { useFeedbackStore } from "./feedbackStore";
import { createConversationServices } from "../services/conversations";
import { createMessageServices } from "../services/messages";
import { InMemoryStorage } from "../services/storage/InMemoryStorage";
import { STORE_NAMES } from "../services/storage";
import type { Conversation, Message } from "../types/studio";

// conversationsStore 分页动作（server 模式分页 PR-c）。
// 用 InMemoryStorage 走真实分页语义（DESC、游标、total），不用 spy 空 mock。

function makeConversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: id,
    summary: "",
    isTitleManuallySet: false,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeMessage(
  id: string,
  conversationId: string,
  createdAt: string,
  status: Message["status"] = "success",
): Message {
  return {
    id,
    conversationId,
    role: "user",
    content: id,
    referencedImageIds: [],
    resultImageIds: [],
    status,
    createdAt,
  };
}

/** 生成递增时间戳：2026-08-01T00:00:{seq} ，seq 越大越新。 */
function ts(seq: number): string {
  return `2026-08-01T00:${String(Math.floor(seq / 60)).padStart(2, "0")}:${String(
    seq % 60,
  ).padStart(2, "0")}.000Z`;
}

function setup() {
  const storage = new InMemoryStorage();
  const store = useConversationsStore();
  const context = {
    services: {
      conversations: createConversationServices(storage),
      messages: createMessageServices(storage),
    },
    clearDraft: vi.fn(),
    onStorageError: vi.fn(),
    refreshStorageUsage: vi.fn().mockResolvedValue(undefined),
  };
  store.configureConversationsStore(context);
  return { store, storage, context };
}

async function seedConversations(storage: InMemoryStorage, count: number) {
  for (let i = 1; i <= count; i++) {
    // i 越大 updatedAt 越新，DESC 序下 id 序号大的在前
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation(`c-${i}`, ts(i)),
    );
  }
}

async function seedMessages(
  storage: InMemoryStorage,
  conversationId: string,
  count: number,
  prefix = "m",
) {
  for (let i = 1; i <= count; i++) {
    await storage.put(
      STORE_NAMES.messages,
      makeMessage(`${prefix}-${i}`, conversationId, ts(i)),
    );
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("conversationsStore 会话列表分页", () => {
  it("loadConversationsFirstPage 整体替换列表并设置游标/total", async () => {
    const { store, storage } = setup();
    await seedConversations(storage, CONVERSATIONS_PAGE_SIZE + 10);
    store.conversations = [makeConversation("stale", ts(0))];

    const data = await store.loadConversationsFirstPage();

    expect(data).toHaveLength(CONVERSATIONS_PAGE_SIZE);
    expect(store.conversations).toHaveLength(CONVERSATIONS_PAGE_SIZE);
    expect(store.conversations).not.toContainEqual(
      expect.objectContaining({ id: "stale" }),
    );
    // DESC：最新的（序号最大）在最前
    expect(store.conversations[0]?.id).toBe(
      `c-${CONVERSATIONS_PAGE_SIZE + 10}`,
    );
    expect(store.conversationsNextCursor).not.toBeNull();
    expect(store.conversationsTotal).toBe(CONVERSATIONS_PAGE_SIZE + 10);
  });

  it("loadMoreConversations 追加下一页，耗尽后游标置空且不再请求", async () => {
    const { store, storage } = setup();
    await seedConversations(storage, CONVERSATIONS_PAGE_SIZE + 10);
    const listPageSpy = vi.spyOn(storage, "listPage");

    await store.loadConversationsFirstPage();
    await store.loadMoreConversations();

    expect(store.conversations).toHaveLength(CONVERSATIONS_PAGE_SIZE + 10);
    expect(store.conversationsNextCursor).toBeNull();

    const callsAfterExhausted = listPageSpy.mock.calls.length;
    await store.loadMoreConversations(); // 无游标：no-op
    expect(listPageSpy.mock.calls.length).toBe(callsAfterExhausted);
  });
});

describe("conversationsStore 消息窗口", () => {
  it("loadConversationMessages 替换窗口为最新一页（正序展示）并设置游标", async () => {
    const { store, storage } = setup();
    await seedMessages(storage, "conv-1", MESSAGES_PAGE_SIZE + 10);

    await store.loadConversationMessages("conv-1");

    expect(store.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    expect(store.messagesWindowConversationId).toBe("conv-1");
    expect(store.messagesNextCursor).not.toBeNull();
    // 存储 DESC → 展示正序：窗口内 createdAt 递增，且是最新的一页
    const createdAts = store.messages.map((message) => message.createdAt);
    expect(createdAts).toEqual([...createdAts].sort());
    expect(store.messages.at(-1)?.id).toBe(`m-${MESSAGES_PAGE_SIZE + 10}`);
  });

  it("同一会话重复加载被跳过（幂等去重）", async () => {
    const { store, storage } = setup();
    await seedMessages(storage, "conv-1", 3);
    const listPageSpy = vi.spyOn(storage, "listPage");

    await store.loadConversationMessages("conv-1");
    await store.loadConversationMessages("conv-1");

    expect(listPageSpy).toHaveBeenCalledTimes(1);
  });

  it("快速连续切换会话时过期结果被丢弃（token 竞态守卫）", async () => {
    const { store, storage } = setup();
    await seedMessages(storage, "conv-1", 3, "a");
    await seedMessages(storage, "conv-2", 3, "b");

    const first = store.loadConversationMessages("conv-1");
    const second = store.loadConversationMessages("conv-2");
    await Promise.all([first, second]);

    expect(store.messagesWindowConversationId).toBe("conv-2");
    expect(store.messages.map((message) => message.conversationId)).toEqual([
      "conv-2",
      "conv-2",
      "conv-2",
    ]);
  });

  it("pending 消息归一化为 error 并回写持久化", async () => {
    const { store, storage } = setup();
    await storage.put(
      STORE_NAMES.messages,
      makeMessage("m-pending", "conv-1", ts(1), "pending"),
    );

    await store.loadConversationMessages("conv-1");

    expect(store.messages[0]?.status).toBe("error");
    const persisted = await storage.get<Message>(
      STORE_NAMES.messages,
      "m-pending",
    );
    expect(persisted?.status).toBe("error");
  });

  it("loadEarlierMessages 向窗口前部 prepend 更早一页，保持正序", async () => {
    const { store, storage } = setup();
    await seedMessages(storage, "conv-1", MESSAGES_PAGE_SIZE + 10);

    await store.loadConversationMessages("conv-1");
    await store.loadEarlierMessages();

    expect(store.messages).toHaveLength(MESSAGES_PAGE_SIZE + 10);
    expect(store.messagesNextCursor).toBeNull();
    const createdAts = store.messages.map((message) => message.createdAt);
    expect(createdAts).toEqual([...createdAts].sort());
    expect(store.messages[0]?.id).toBe("m-1"); // 最早的一条被 prepend 到头部
  });

  it("loadEarlierMessages 加载期间窗口被切走则丢弃结果", async () => {
    const { store, storage } = setup();
    await seedMessages(storage, "conv-1", MESSAGES_PAGE_SIZE + 10, "a");
    await seedMessages(storage, "conv-2", 3, "b");

    await store.loadConversationMessages("conv-1");
    const earlier = store.loadEarlierMessages();
    await store.loadConversationMessages("conv-2"); // 切走窗口
    await earlier;

    expect(store.messages.every((message) => message.conversationId === "conv-2")).toBe(
      true,
    );
    expect(store.messages).toHaveLength(3);
  });

  it("clearMessagesWindow / resetPagination 清空窗口与分页状态", async () => {
    const { store, storage } = setup();
    await seedConversations(storage, 3);
    await seedMessages(storage, "conv-1", 3);
    await store.loadConversationsFirstPage();
    await store.loadConversationMessages("conv-1");

    store.resetPagination();

    expect(store.conversations).toEqual([]);
    expect(store.conversationsNextCursor).toBeNull();
    expect(store.conversationsTotal).toBe(0);
    expect(store.messages).toEqual([]);
    expect(store.messagesWindowConversationId).toBe("");
    expect(store.messagesNextCursor).toBeNull();
  });
});

describe("conversationsStore 级联删除（窗口模型）", () => {
  it("deleteConversation 删除窗口外的历史消息（查存储而非内存 filter）", async () => {
    const { store, storage, context } = setup();
    const total = MESSAGES_PAGE_SIZE + 10;
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-1", ts(1)),
    );
    await seedMessages(storage, "conv-1", total);
    await store.loadConversationsFirstPage();
    await store.loadConversationMessages("conv-1"); // 窗口只有最新 50 条

    const deleting = store.deleteConversation("conv-1");
    useFeedbackStore().acceptConfirmDialog(); // 模拟用户确认
    await deleting;

    const remaining = await storage.list(STORE_NAMES.messages);
    expect(remaining).toHaveLength(0);
    expect(store.conversations).toHaveLength(0);
    expect(context.refreshStorageUsage).toHaveBeenCalled();
  });
});
