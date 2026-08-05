// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useStudioRestore } from "./useStudioRestore";
import { createConversationServices } from "../../services/conversations";
import { createMessageServices } from "../../services/messages";
import { createImageAssetServices } from "../../services/imageAssets";
import { createSettingsServices } from "../../services/settings";
import { createTimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { InMemoryStorage } from "../../services/storage/InMemoryStorage";
import { STORE_NAMES } from "../../services/storage";
import type { Conversation, ImageAsset, Message } from "../../types/studio";

// useStudioRestore 编排测试（server 模式分页 PR-c）。
// store 动作用 vi.fn 替身（restore 不再直接赋值数据 ref），真实 services +
// InMemoryStorage 走真实存储，验证"按需加载、不再全量"的编排契约。

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

function makeMessage(id: string, conversationId: string): Message {
  return {
    id,
    conversationId,
    role: "user",
    content: id,
    referencedImageIds: [],
    resultImageIds: [],
    status: "success",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeAsset(id: string, conversationId?: string): ImageAsset {
  return {
    id,
    blobKey: `blob-${id}`,
    name: id,
    source: "generated",
    conversationId,
    prompt: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function setup() {
  const storage = new InMemoryStorage();
  const services = {
    conversations: createConversationServices(storage),
    messages: createMessageServices(storage),
    imageAssets: createImageAssetServices(storage),
    settings: createSettingsServices(storage),
    timeFieldMigration: createTimeFieldMigrationServices(storage),
  };
  const input = {
    services,
    activeConversationId: ref(""),
    applySettings: vi.fn(),
    attachedImages: ref<string[]>(["stale-attachment"]),
    isHydrated: ref(false),
    notifyError: vi.fn(),
    onStorageError: vi.fn(),
    refreshStorageUsage: vi.fn().mockResolvedValue(undefined),
    saveCurrentSettings: vi.fn().mockResolvedValue(undefined),
    resetPagination: vi.fn(),
    loadConversationsFirstPage: vi.fn(),
    loadConversationMessages: vi.fn().mockResolvedValue(undefined),
    loadAssetsFirstPage: vi.fn(),
    ensureConversationAssets: vi.fn().mockResolvedValue(undefined),
    companionUrl: ref(""),
    companionAccessKey: ref(""),
    isEmbedded: ref(false),
  };
  // store 动作替身默认走真实 service 分页，返回真实数据
  input.loadConversationsFirstPage.mockImplementation(() =>
    services.conversations.listPage({ limit: 50 }).then((page) => page.data),
  );
  input.loadAssetsFirstPage.mockImplementation(() =>
    services.imageAssets.listAssetsPage({ limit: 100 }).then((page) => page.data),
  );
  const restore = useStudioRestore(input);
  return { storage, services, input, restore };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useStudioRestore 按需加载编排（PR-c）", () => {
  it("只拉第一页会话/图片 + 当前会话消息窗口，不做全量 list", async () => {
    const { storage, services, input, restore } = setup();
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-a", "2026-08-02T00:00:00.000Z"),
    );
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-b", "2026-08-01T00:00:00.000Z"),
    );
    await storage.put(STORE_NAMES.messages, makeMessage("m-a", "conv-a"));
    await storage.put(STORE_NAMES.imageAssets, makeAsset("img-a", "conv-a"));
    const listMessagesSpy = vi.spyOn(services.messages, "list");

    await restore.restoreFromStorage();

    expect(input.resetPagination).toHaveBeenCalled();
    expect(input.attachedImages.value).toEqual([]);
    expect(input.loadConversationsFirstPage).toHaveBeenCalledTimes(1);
    expect(input.loadAssetsFirstPage).toHaveBeenCalledTimes(1);
    // 激活第一页第一个（updatedAt DESC），并加载其消息窗口 + 图片全量
    expect(input.activeConversationId.value).toBe("conv-a");
    expect(input.loadConversationMessages).toHaveBeenCalledWith("conv-a");
    expect(input.ensureConversationAssets).toHaveBeenCalledWith("conv-a");
    // 全量读取已废弃：messages.list 一次都不应被调用
    expect(listMessagesSpy).not.toHaveBeenCalled();
    expect(input.refreshStorageUsage).toHaveBeenCalled();
    expect(input.isHydrated.value).toBe(true);
    expect(input.notifyError).not.toHaveBeenCalled();
  });

  it("URL ?c=<id> 命中第一页时优先激活", async () => {
    const { storage, input, restore } = setup();
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-a", "2026-08-02T00:00:00.000Z"),
    );
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-b", "2026-08-01T00:00:00.000Z"),
    );
    window.history.replaceState(null, "", "/?c=conv-b");

    await restore.restoreFromStorage();

    expect(input.activeConversationId.value).toBe("conv-b");
    expect(input.loadConversationMessages).toHaveBeenCalledWith("conv-b");
  });

  it("URL ?c=<id> 不在第一页时 getById 兜底验证后激活", async () => {
    const { storage, input, restore } = setup();
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-a", "2026-08-02T00:00:00.000Z"),
    );
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-old", "2026-01-01T00:00:00.000Z"),
    );
    // 第一页替身只返回 conv-a（模拟 conv-old 在翻页区之外）
    input.loadConversationsFirstPage.mockResolvedValue([
      makeConversation("conv-a", "2026-08-02T00:00:00.000Z"),
    ]);
    window.history.replaceState(null, "", "/?c=conv-old");

    await restore.restoreFromStorage();

    expect(input.activeConversationId.value).toBe("conv-old");
  });

  it("URL ?c=<id> 无效（已删除/其它后端）时静默回落第一个", async () => {
    const { storage, input, restore } = setup();
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("conv-a", "2026-08-02T00:00:00.000Z"),
    );
    window.history.replaceState(null, "", "/?c=ghost");

    await restore.restoreFromStorage();

    expect(input.activeConversationId.value).toBe("conv-a");
    expect(input.notifyError).not.toHaveBeenCalled();
  });

  it("legacy 演示种子（c-1/m-1/img-1）在恢复时被清理", async () => {
    const { storage, input, restore } = setup();
    await storage.put(
      STORE_NAMES.conversations,
      makeConversation("c-1", "2026-08-01T00:00:00.000Z"),
    );
    await storage.put(STORE_NAMES.messages, makeMessage("m-1", "c-1"));
    await storage.put(STORE_NAMES.imageAssets, makeAsset("img-1", "c-1"));

    await restore.restoreFromStorage();

    expect(await storage.list(STORE_NAMES.conversations)).toHaveLength(0);
    expect(await storage.list(STORE_NAMES.messages)).toHaveLength(0);
    expect(await storage.list(STORE_NAMES.imageAssets)).toHaveLength(0);
    // 种子清理后重新拉取第一页（两次调用）
    expect(input.loadConversationsFirstPage).toHaveBeenCalledTimes(2);
  });

  it("存储异常时 notifyError 且 isHydrated 仍置位", async () => {
    const { input, restore } = setup();
    input.loadConversationsFirstPage.mockRejectedValue(new Error("db gone"));

    await restore.restoreFromStorage();

    expect(input.notifyError).toHaveBeenCalledWith(
      expect.stringContaining("读取本地数据失败"),
    );
    expect(input.onStorageError).toHaveBeenCalled();
    expect(input.isHydrated.value).toBe(true);
  });
});
