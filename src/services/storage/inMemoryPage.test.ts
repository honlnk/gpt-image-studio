/**
 * iterateAll 单元测试（server 模式分页 PR-e）。
 *
 * 测的是迭代逻辑本身（游标翻页、onPage 回调、无 listPage 回退），
 * 不是某个 StudioStorage 实现——实现层由 storage.contract.test.ts 覆盖。
 */
import { describe, expect, it, vi } from "vitest";
import { iterateAll } from "./inMemoryPage";
import { createSpyStorage } from "./createSpyStorage";
import { STORE_NAMES } from "./types";

describe("iterateAll", () => {
  it("支持 listPage 时游标翻页直到拉完全部", async () => {
    const storage = createSpyStorage();
    // 模拟两页：第一页 2 条带游标，第二页 1 条无游标。
    storage.listPage
      .mockResolvedValueOnce({
        data: [{ id: "1" }, { id: "2" }],
        nextCursor: "cursor-1",
        total: 3,
      })
      .mockResolvedValueOnce({
        data: [{ id: "3" }],
        nextCursor: null,
        total: 3,
      });

    const result = await iterateAll<{ id: string }>(
      storage,
      STORE_NAMES.conversations,
    );

    expect(result).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
    // 第二次调用应带上第一页返回的游标。
    expect(storage.listPage).toHaveBeenCalledTimes(2);
    expect(storage.listPage).toHaveBeenNthCalledWith(2, STORE_NAMES.conversations, {
      limit: 200,
      before: "cursor-1",
    });
    // list 不应被调用（走的是 listPage 路径）。
    expect(storage.list).not.toHaveBeenCalled();
  });

  it("onPage 回调在每页拉完后触发，参数为累计条数", async () => {
    const storage = createSpyStorage();
    storage.listPage
      .mockResolvedValueOnce({
        data: [{ id: "1" }, { id: "2" }],
        nextCursor: "cursor-1",
        total: 4,
      })
      .mockResolvedValueOnce({
        data: [{ id: "3" }, { id: "4" }],
        nextCursor: null,
        total: 4,
      });

    const onPage = vi.fn();
    await iterateAll(storage, STORE_NAMES.messages, { onPage });

    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(1, 2);
    expect(onPage).toHaveBeenNthCalledWith(2, 4);
  });

  it("空表：单次请求返回空 + 无游标，onPage 触发一次(0)", async () => {
    const storage = createSpyStorage();
    storage.listPage.mockResolvedValue({ data: [], nextCursor: null, total: 0 });

    const onPage = vi.fn();
    const result = await iterateAll(storage, STORE_NAMES.imageAssets, { onPage });

    expect(result).toEqual([]);
    expect(storage.listPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(0);
  });

  it("自定义 pageSize 透传到每次 listPage 调用", async () => {
    const storage = createSpyStorage();
    storage.listPage.mockResolvedValue({ data: [{ id: "1" }], nextCursor: null, total: 1 });

    await iterateAll(storage, STORE_NAMES.conversations, { pageSize: 50 });

    expect(storage.listPage).toHaveBeenCalledWith(STORE_NAMES.conversations, {
      limit: 50,
    });
  });

  it("conversationId 过滤透传到每次 listPage 调用", async () => {
    const storage = createSpyStorage();
    storage.listPage
      .mockResolvedValueOnce({
        data: [{ id: "1" }],
        nextCursor: "c1",
        total: 2,
      })
      .mockResolvedValueOnce({
        data: [{ id: "2" }],
        nextCursor: null,
        total: 2,
      });

    await iterateAll(storage, STORE_NAMES.messages, { conversationId: "conv-1" });

    expect(storage.listPage).toHaveBeenNthCalledWith(1, STORE_NAMES.messages, {
      limit: 200,
      conversationId: "conv-1",
    });
    expect(storage.listPage).toHaveBeenNthCalledWith(2, STORE_NAMES.messages, {
      limit: 200,
      before: "c1",
      conversationId: "conv-1",
    });
  });

  it("不支持 listPage 时回退单次 list() 全量", async () => {
    const storage = createSpyStorage();
    // 删除 listPage 模拟不支持可选方法的后端。
    // @ts-expect-error 故意删掉可选方法
    delete storage.listPage;
    storage.list.mockResolvedValue([{ id: "1" }, { id: "2" }]);

    const onPage = vi.fn();
    const result = await iterateAll(storage, STORE_NAMES.conversations, { onPage });

    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
    expect(storage.list).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
