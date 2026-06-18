import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureTracker,
  resetTracker,
  setFlushedListener,
  setTrackerContext,
  track,
} from "./useAnalyticsTracker";
import type { AnalyticsEvent } from "../../types/studio";

const mocks = vi.hoisted(() => ({
  saveAnalyticsEventsBatch: vi.fn(),
}));

vi.mock("../../services/analyticsEvents", () => ({
  saveAnalyticsEventsBatch: mocks.saveAnalyticsEventsBatch,
}));

function configure() {
  configureTracker({
    enabled: true,
    promptCapture: "length_only",
    sessionId: "sess-1",
  });
}

function flushedEvents(): AnalyticsEvent[] {
  const calls = mocks.saveAnalyticsEventsBatch.mock.calls;
  return calls.flatMap((call) => call[0] as AnalyticsEvent[]);
}

describe("useAnalyticsTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTracker();
  });

  it("does not record when disabled", async () => {
    configureTracker({
      enabled: false,
      promptCapture: "length_only",
      sessionId: "sess-1",
    });

    track("chat.submit");
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mocks.saveAnalyticsEventsBatch).not.toHaveBeenCalled();
  });

  it("does not record without a session id", async () => {
    configureTracker({
      enabled: true,
      promptCapture: "length_only",
      sessionId: "",
    });

    track("chat.submit");
    await vi.runAllTimersAsync();

    expect(mocks.saveAnalyticsEventsBatch).not.toHaveBeenCalled();
  });

  it("records an event with context and source", async () => {
    configure();
    setTrackerContext({ conversationId: "c-1", messageId: "m-1" });

    track("chat.submit", { foo: "bar" }, "ui_click");
    await vi.runAllTimersAsync();

    const events = flushedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "chat.submit",
      sessionId: "sess-1",
      conversationId: "c-1",
      messageId: "m-1",
      source: "ui_click",
      payload: { foo: "bar" },
    });
  });

  it("applies length_only sanitization to prompt-like fields", async () => {
    configure();
    track("generation.requested", { prompt: "一只可爱的猫" });
    await vi.runAllTimersAsync();

    const events = flushedEvents();
    expect(events[0].payload).toEqual({ prompt: { length: 6 } });
  });

  it("applies masked sanitization to prompt-like fields", async () => {
    configureTracker({
      enabled: true,
      promptCapture: "masked",
      sessionId: "sess-1",
    });
    track("generation.requested", { prompt: "一只可爱的猫坐在窗台上" });
    await vi.runAllTimersAsync();

    const events = flushedEvents();
    expect(events[0].payload).toEqual({ prompt: "一只***台上" });
  });

  it("removes prompt-like fields when capture is none", async () => {
    configureTracker({
      enabled: true,
      promptCapture: "none",
      sessionId: "sess-1",
    });
    track("generation.requested", { prompt: "一只猫", count: 2 });
    await vi.runAllTimersAsync();

    const events = flushedEvents();
    expect(events[0].payload).toEqual({ count: 2 });
  });

  it("keeps prompt verbatim when capture is raw", async () => {
    configureTracker({
      enabled: true,
      promptCapture: "raw",
      sessionId: "sess-1",
    });
    track("generation.requested", { prompt: "一只猫" });
    await vi.runAllTimersAsync();

    const events = flushedEvents();
    expect(events[0].payload).toEqual({ prompt: "一只猫" });
  });

  it("flushes immediately when batch size is reached", async () => {
    configure();
    for (let i = 0; i < 50; i++) {
      track("chat.submit");
    }

    // 达到批次阈值会立即 flush（微任务），无需推进定时器。
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.saveAnalyticsEventsBatch).toHaveBeenCalledTimes(1);
    expect(mocks.saveAnalyticsEventsBatch.mock.calls[0][0]).toHaveLength(50);
  });

  it("swallows persistence errors without throwing", async () => {
    configure();
    mocks.saveAnalyticsEventsBatch.mockRejectedValue(new Error("db down"));

    track("chat.submit");
    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(mocks.saveAnalyticsEventsBatch).toHaveBeenCalled();
    });

    // 第二次 track 不应抛错，说明前一次失败已被吞掉。
    await expect(
      (async () => {
        track("chat.submit");
        await vi.runAllTimersAsync();
      })(),
    ).resolves.toBeUndefined();
  });

  it("notifies the flushed listener with the batch size on success", async () => {
    vi.useRealTimers();
    mocks.saveAnalyticsEventsBatch.mockResolvedValue(undefined);
    configure();
    const listener = vi.fn();
    setFlushedListener(listener);

    track("chat.submit");
    track("image.downloaded", { imageId: "img-1" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocks.saveAnalyticsEventsBatch).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(2);
    vi.useFakeTimers();
  });

  it("does not notify the listener when persistence fails", async () => {
    configure();
    mocks.saveAnalyticsEventsBatch.mockRejectedValue(new Error("db down"));
    const listener = vi.fn();
    setFlushedListener(listener);

    track("chat.submit");
    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(mocks.saveAnalyticsEventsBatch).toHaveBeenCalled();
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
