// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getHostActionsForTest,
  configureEmbedding,
  isEmbeddedChildMessage,
  listenHostMessages,
  notifyHostActiveConversationChanged,
  notifyHostConversationsChanged,
  setHostActions,
  type HostActions,
} from "./embeddedBridge";

/**
 * 构造带 source/origin 的 MessageEvent（绕开 jsdom/happy-dom 坑）。
 *
 * window.postMessage 派发的 MessageEvent source 为 null，会全挂在 source 守卫上。
 * 用例必须手动构造完整的 MessageEvent 再 dispatchEvent（见文档 PR7 §3.10）。
 */
function dispatchHostMessage(
  data: unknown,
  origin = window.location.origin,
  source: MessageEventSource | null = window,
): void {
  const event = new MessageEvent("message", { data, origin, source });
  window.dispatchEvent(event);
}

/** 捕获 window.postMessage 的调用（用于测 notifyHostConversationsChanged）。 */
function capturePostMessage() {
  const calls: { data: unknown; origin: string }[] = [];
  const spy = vi.spyOn(window, "postMessage").mockImplementation(
    (data, origin) => {
      calls.push({ data, origin: String(origin) });
    },
  );
  return { calls, restore: () => spy.mockRestore() };
}

describe("embeddedBridge hostActions 桥接", () => {
  afterEach(() => {
    setHostActions(null);
  });

  it("setHostActions 注入后可读取", () => {
    const actions: HostActions = {
      select: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn(),
      openSettings: vi.fn(),
    };
    setHostActions(actions);
    expect(__getHostActionsForTest()).toBe(actions);
  });

  it("setHostActions(null) 撤销", () => {
    setHostActions({
      select: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn(),
      openSettings: vi.fn(),
    });
    setHostActions(null);
    expect(__getHostActionsForTest()).toBeNull();
  });
});

describe("listenHostMessages 守卫", () => {
  let teardown: (() => void) | undefined;
  const originalQiankun = window.__POWERED_BY_QIANKUN__;

  beforeEach(() => {
    window.__POWERED_BY_QIANKUN__ = true as unknown as undefined;
    teardown = listenHostMessages();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    window.__POWERED_BY_QIANKUN__ = originalQiankun;
    setHostActions(null);
    configureEmbedding({ allowedOrigins: undefined });
  });

  it("合法的 select-conversation 调用 hostActions.select", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage({ type: "select-conversation", id: "conv-1" });
    expect(select).toHaveBeenCalledWith("conv-1");
  });

  it("合法的 create-conversation 调用 hostActions.create", () => {
    const create = vi.fn();
    setHostActions({ select: vi.fn(), create, delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage({ type: "create-conversation" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("合法的 delete-conversation 调用 hostActions.delete", () => {
    const del = vi.fn();
    setHostActions({ select: vi.fn(), create: vi.fn(), delete: del, rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage({ type: "delete-conversation", id: "conv-2" });
    expect(del).toHaveBeenCalledWith("conv-2");
  });

  it("合法的 rename-conversation 调用 hostActions.rename", () => {
    const rename = vi.fn();
    setHostActions({ select: vi.fn(), create: vi.fn(), delete: vi.fn(), rename, openSettings: vi.fn() });
    dispatchHostMessage({ type: "rename-conversation", id: "conv-3" });
    expect(rename).toHaveBeenCalledWith("conv-3");
  });

  it("合法的 open-settings 调用 hostActions.openSettings", () => {
    const openSettings = vi.fn();
    setHostActions({ select: vi.fn(), create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings });
    dispatchHostMessage({ type: "open-settings" });
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("独立态（非 __POWERED_BY_QIANKUN__）忽略所有消息", () => {
    window.__POWERED_BY_QIANKUN__ = undefined;
    const actions: HostActions = {
      select: vi.fn(), create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn(),
    };
    setHostActions(actions);
    dispatchHostMessage({ type: "select-conversation", id: "x" });
    dispatchHostMessage({ type: "create-conversation" });
    dispatchHostMessage({ type: "delete-conversation", id: "x" });
    dispatchHostMessage({ type: "rename-conversation", id: "x" });
    expect(actions.select).not.toHaveBeenCalled();
    expect(actions.create).not.toHaveBeenCalled();
    expect(actions.delete).not.toHaveBeenCalled();
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it("source 为 null 拒绝（过滤合成事件）", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage(
      { type: "select-conversation", id: "conv-1" },
      window.location.origin,
      null,
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("跨 origin 消息拒绝（同源校验）", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage(
      { type: "select-conversation", id: "conv-1" },
      "https://evil.example.com",
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("跨 origin 但命中白名单放行（configureEmbedding 注入）", () => {
    configureEmbedding({ allowedOrigins: ["https://admin.example.com"] });
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage(
      { type: "select-conversation", id: "conv-1" },
      "https://admin.example.com",
    );
    expect(select).toHaveBeenCalledWith("conv-1");
  });

  it("跨 origin 白名单外的 origin 仍拒绝", () => {
    configureEmbedding({ allowedOrigins: ["https://admin.example.com"] });
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage(
      { type: "select-conversation", id: "conv-1" },
      "https://evil.example.com",
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("同源消息在白名单配置后仍放行（向后兼容）", () => {
    configureEmbedding({ allowedOrigins: ["https://admin.example.com"] });
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage({ type: "select-conversation", id: "conv-1" });
    expect(select).toHaveBeenCalledWith("conv-1");
  });

  it("configureEmbedding 对非法 origin 静默丢弃", () => {
    configureEmbedding({ allowedOrigins: ["not-a-url", "https://valid.example.com"] });
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage(
      { type: "select-conversation", id: "conv-1" },
      "https://valid.example.com",
    );
    expect(select).toHaveBeenCalledWith("conv-1");
  });

  it("select/delete/rename 缺 id 字段拒绝", () => {
    const actions: HostActions = {
      select: vi.fn(), create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn(),
    };
    setHostActions(actions);
    dispatchHostMessage({ type: "select-conversation" });
    dispatchHostMessage({ type: "delete-conversation" });
    dispatchHostMessage({ type: "rename-conversation", id: 123 });
    expect(actions.select).not.toHaveBeenCalled();
    expect(actions.delete).not.toHaveBeenCalled();
    expect(actions.rename).not.toHaveBeenCalled();
  });

  it("未知 type 拒绝", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage({ type: "unknown", id: "x" });
    expect(select).not.toHaveBeenCalled();
  });

  it("data 非对象拒绝", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    dispatchHostMessage("not-an-object");
    dispatchHostMessage(null);
    dispatchHostMessage(42);
    expect(select).not.toHaveBeenCalled();
  });

  it("未注入 hostActions 时不报错（no-op）", () => {
    expect(() => {
      dispatchHostMessage({ type: "select-conversation", id: "conv-1" });
      dispatchHostMessage({ type: "create-conversation" });
    }).not.toThrow();
  });

  it("卸载函数移除监听（卸载后消息不再触发）", () => {
    const select = vi.fn();
    setHostActions({ select, create: vi.fn(), delete: vi.fn(), rename: vi.fn(), openSettings: vi.fn() });
    teardown?.();
    teardown = undefined;
    dispatchHostMessage({ type: "select-conversation", id: "conv-1" });
    expect(select).not.toHaveBeenCalled();
  });
});

describe("notifyHostConversationsChanged（子应用→宿主反向消息）", () => {
  const originalQiankun = window.__POWERED_BY_QIANKUN__;

  afterEach(() => {
    window.__POWERED_BY_QIANKUN__ = originalQiankun;
    configureEmbedding({ allowedOrigins: undefined });
  });

  it("嵌入态发 conversations-changed 消息到 window", () => {
    window.__POWERED_BY_QIANKUN__ = true as unknown as undefined;
    const { calls, restore } = capturePostMessage();

    notifyHostConversationsChanged();

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toEqual({ type: "conversations-changed" });
    expect(calls[0].origin).toBe(window.location.origin);
    restore();
  });

  it("独立态 no-op（不发消息）", () => {
    window.__POWERED_BY_QIANKUN__ = undefined;
    const { calls, restore } = capturePostMessage();

    notifyHostConversationsChanged();

    expect(calls).toHaveLength(0);
    restore();
  });

  it("配置单一白名单 origin 时 targetOrigin 用精确 origin", () => {
    window.__POWERED_BY_QIANKUN__ = true as unknown as undefined;
    configureEmbedding({ allowedOrigins: ["https://admin.example.com"] });
    const { calls, restore } = capturePostMessage();

    notifyHostConversationsChanged();

    expect(calls[0].origin).toBe("https://admin.example.com");
    restore();
  });
});

describe("notifyHostActiveConversationChanged（激活态信号）", () => {
  const originalQiankun = window.__POWERED_BY_QIANKUN__;

  afterEach(() => {
    window.__POWERED_BY_QIANKUN__ = originalQiankun;
  });

  it("嵌入态发 active-conversation-changed 消息（带 id）", () => {
    window.__POWERED_BY_QIANKUN__ = true as unknown as undefined;
    const { calls, restore } = capturePostMessage();

    notifyHostActiveConversationChanged("conv-9");

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toEqual({ type: "active-conversation-changed", id: "conv-9" });
    expect(calls[0].origin).toBe(window.location.origin);
    restore();
  });

  it("空 id 原样发送（表示无激活会话，宿主清空高亮）", () => {
    window.__POWERED_BY_QIANKUN__ = true as unknown as undefined;
    const { calls, restore } = capturePostMessage();

    notifyHostActiveConversationChanged("");

    expect(calls[0].data).toEqual({ type: "active-conversation-changed", id: "" });
    restore();
  });

  it("独立态 no-op（不发消息）", () => {
    window.__POWERED_BY_QIANKUN__ = undefined;
    const { calls, restore } = capturePostMessage();

    notifyHostActiveConversationChanged("conv-9");

    expect(calls).toHaveLength(0);
    restore();
  });
});

describe("isEmbeddedChildMessage（宿主侧类型守卫）", () => {
  it("conversations-changed 合法", () => {
    expect(isEmbeddedChildMessage({ type: "conversations-changed" })).toBe(true);
  });

  it("active-conversation-changed 合法", () => {
    expect(
      isEmbeddedChildMessage({ type: "active-conversation-changed", id: "conv-1" }),
    ).toBe(true);
  });

  it("未知 type 拒绝", () => {
    expect(isEmbeddedChildMessage({ type: "unknown" })).toBe(false);
  });

  it("非对象拒绝", () => {
    expect(isEmbeddedChildMessage(null)).toBe(false);
    expect(isEmbeddedChildMessage("x")).toBe(false);
    expect(isEmbeddedChildMessage(42)).toBe(false);
  });

  it("type 非字符串拒绝", () => {
    expect(isEmbeddedChildMessage({ type: 123 })).toBe(false);
  });
});
