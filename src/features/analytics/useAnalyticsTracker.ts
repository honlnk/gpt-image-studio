import type {
  AnalyticsEvent,
  AnalyticsEventSource,
  AnalyticsPromptCapture,
} from "../../types/studio";
import { createId } from "../../shared/id";
import { isoTimestamp } from "../../shared/dateTime";
import { saveAnalyticsEventsBatch } from "../../services/analyticsEvents";

/**
 * Analytics tracker (V1.0)
 *
 * 设计要点：
 * - 维护一份模块级单例状态，供 v-track 指令和业务方法共享。
 * - track() 全程吞错，埋点失败绝不影响业务主流程。
 * - payload 中名为 prompt/text 的字段按 analyticsPromptCapture 策略脱敏。
 * - 事件先入内存队列，节流批量落库（降低 IndexedDB 写入压力）。
 */

type TrackerContext = {
  conversationId?: string;
  messageId?: string;
  imageId?: string;
};

type TrackerConfig = {
  enabled: boolean;
  promptCapture: AnalyticsPromptCapture;
  sessionId: string;
};

const FLUSH_DELAY_MS = 500;
const FLUSH_BATCH_SIZE = 50;

const PROMPT_LIKE_KEYS = new Set(["prompt", "text", "content"]);

const state: TrackerConfig & TrackerContext = {
  enabled: true,
  promptCapture: "length_only",
  sessionId: "",
};

const queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> = Promise.resolve();
let onFlushed: ((count: number) => void) | null = null;

/**
 * 注册 flush 成功落库后的回调。
 * 用于让 store 同步更新响应式计数（事件由模块级队列写入，store 无法自动感知）。
 */
export function setFlushedListener(listener: ((count: number) => void) | null) {
  onFlushed = listener;
}

export function configureTracker(config: Partial<TrackerConfig>) {
  if (typeof config.enabled === "boolean") state.enabled = config.enabled;
  if (config.promptCapture) state.promptCapture = config.promptCapture;
  if (config.sessionId) state.sessionId = config.sessionId;
}

export function setTrackerContext(context: Partial<TrackerContext>) {
  if ("conversationId" in context) state.conversationId = context.conversationId;
  if ("messageId" in context) state.messageId = context.messageId;
  if ("imageId" in context) state.imageId = context.imageId;
}

export function track(
  eventName: string,
  payload?: Record<string, unknown>,
  source: AnalyticsEventSource = "system",
) {
  try {
    if (!state.enabled || !state.sessionId) return;

    const event: AnalyticsEvent = {
      id: createId("ev"),
      eventName,
      occurredAt: isoTimestamp(),
      sessionId: state.sessionId,
      source,
      ...(state.conversationId
        ? { conversationId: state.conversationId }
        : {}),
      ...(state.messageId ? { messageId: state.messageId } : {}),
      ...(state.imageId ? { imageId: state.imageId } : {}),
      ...(payload ? { payload: sanitizePayload(payload) } : {}),
    };

    queue.push(event);
    scheduleFlush();
  } catch {
    // 埋点失败静默吞掉，不影响业务。
  }
}

function sanitizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = PROMPT_LIKE_KEYS.has(key)
      ? sanitizePromptValue(value)
      : value;
  }
  return result;
}

function sanitizePromptValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  switch (state.promptCapture) {
    case "none":
      return undefined;
    case "raw":
      return value;
    case "masked": {
      if (value.length <= 4) return "*".repeat(value.length);
      return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }
    case "length_only":
    default:
      return { length: value.length };
  }
}

function scheduleFlush() {
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushNow();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_DELAY_MS);
}

function flushNow() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  flushPromise = flushPromise
    .then(async () => {
      await saveAnalyticsEventsBatch(batch);
      try {
        onFlushed?.(batch.length);
      } catch {
        // 回调失败不影响后续 flush。
      }
    })
    .catch(() => {
      // 落库失败丢弃本批，避免阻塞后续事件。
    });
  return flushPromise;
}

/** 供测试与卸载场景使用：清空队列、取消定时器并重置配置与上下文。 */
export function resetTracker() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  queue.length = 0;
  flushPromise = Promise.resolve();
  onFlushed = null;
  state.enabled = true;
  state.promptCapture = "length_only";
  state.sessionId = "";
  state.conversationId = undefined;
  state.messageId = undefined;
  state.imageId = undefined;
}
