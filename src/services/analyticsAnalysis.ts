/**
 * Analytics V2 分析层（纯函数）。
 *
 * V1 是采集 + 导出（`analyticsEvents.ts` / `analyticsExport.ts`）；本模块在 V1
 * 事件流之上做**只读聚合**，供设置页的数据分析面板使用。所有函数输入事件数组、
 * 输出纯数据，不做 IO、不依赖 Pinia，便于单测。
 *
 * 设计约束：
 * - 不新增 IndexedDB 物化聚合 store（V1 数据量级可接受打开面板时重算）。
 * - 满意度代理基于 imageId 串联现有事件，不新增重复采集事件。
 */

import type { AnalyticsEvent } from "../types/studio";

export type GenerationFunnel = {
  requested: number;
  succeeded: number;
  failed: number;
  /** 成功率 = succeeded / requested（requested 为 0 时为 0）。 */
  successRate: number;
};

export type SatisfactionProxy = {
  /** 生成成功的图片总数（去重 imageId）。 */
  generated: number;
  /** 至少被下载过一次的生成图片数。 */
  downloaded: number;
  /** 被打标（tag color set/changed）的生成图片数。 */
  tagged: number;
  /** 被删除的生成图片数。 */
  deleted: number;
  downloadRate: number;
  tagRate: number;
  /** 保留率 = 未删除 / generated。 */
  keptRate: number;
};

export type PromptModeRow = {
  promptMode: string;
  requested: number;
  succeeded: number;
  successRate: number;
  satisfactionRate: number;
};

export type EventDistributionRow = {
  eventName: string;
  count: number;
};

export type TimeSeriesBucket = {
  /** 桶的日期标签（YYYY-MM-DD）。 */
  date: string;
  requested: number;
  succeeded: number;
};

export type Overview = {
  totalEvents: number;
  sessionCount: number;
  conversationCount: number;
  imageCount: number;
  /** 最早事件时间，无事件为 null。 */
  startAt: string | null;
  /** 最晚事件时间，无事件为 null。 */
  endAt: string | null;
};

export type AnalyticsInsights = {
  overview: Overview;
  funnel: GenerationFunnel;
  satisfaction: SatisfactionProxy;
  promptModes: PromptModeRow[];
  topEvents: EventDistributionRow[];
  timeSeries: TimeSeriesBucket[];
};

const GENERATION_REQUESTED = "generation.requested";
const GENERATION_SUCCEEDED = "generation.succeeded";
const GENERATION_FAILED = "generation.failed";
const IMAGE_DOWNLOADED = "image.downloaded";
const IMAGE_DELETED = "image.deleted";
const IMAGE_TAG_COLOR_SET = "image.tag_color_set";
const IMAGE_TAG_COLOR_CHANGED = "image.tag_color_changed";

/** 从 payload 取 string 值，缺失/类型不符时返回 undefined。 */
function payloadString(
  event: AnalyticsEvent,
  key: string,
): string | undefined {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : undefined;
}

export function computeOverview(events: AnalyticsEvent[]): Overview {
  const sessionIds = new Set<string>();
  const conversationIds = new Set<string>();
  const imageIds = new Set<string>();
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const event of events) {
    sessionIds.add(event.sessionId);
    if (event.conversationId) conversationIds.add(event.conversationId);
    if (event.imageId) imageIds.add(event.imageId);
    const ms = Date.parse(event.occurredAt);
    if (!Number.isNaN(ms)) {
      if (ms < startMs) startMs = ms;
      if (ms > endMs) endMs = ms;
    }
  }
  return {
    totalEvents: events.length,
    sessionCount: sessionIds.size,
    conversationCount: conversationIds.size,
    imageCount: imageIds.size,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
  };
}

export function computeGenerationFunnel(
  events: AnalyticsEvent[],
): GenerationFunnel {
  let requested = 0;
  let succeeded = 0;
  let failed = 0;
  for (const event of events) {
    if (event.eventName === GENERATION_REQUESTED) requested += 1;
    else if (event.eventName === GENERATION_SUCCEEDED) succeeded += 1;
    else if (event.eventName === GENERATION_FAILED) failed += 1;
  }
  return {
    requested,
    succeeded,
    failed,
    successRate: requested > 0 ? succeeded / requested : 0,
  };
}

/**
 * 满意度代理：以 `generation.succeeded` 的 imageId 为基准集合，统计这些图片
 * 后续是否被下载 / 打标 / 删除。生成时未带 imageId 的成功事件无法参与（跳过）。
 */
export function computeSatisfactionProxy(
  events: AnalyticsEvent[],
): SatisfactionProxy {
  const generatedIds = new Set<string>();
  const downloadedIds = new Set<string>();
  const taggedIds = new Set<string>();
  const deletedIds = new Set<string>();
  for (const event of events) {
    if (!event.imageId) continue;
    if (event.eventName === GENERATION_SUCCEEDED) {
      generatedIds.add(event.imageId);
    } else if (event.eventName === IMAGE_DOWNLOADED) {
      downloadedIds.add(event.imageId);
    } else if (
      event.eventName === IMAGE_TAG_COLOR_SET ||
      event.eventName === IMAGE_TAG_COLOR_CHANGED
    ) {
      taggedIds.add(event.imageId);
    } else if (event.eventName === IMAGE_DELETED) {
      deletedIds.add(event.imageId);
    }
  }
  const generated = generatedIds.size;
  // 只计生成图片集合内的下载/打标/删除，排除导入图混入。
  let downloaded = 0;
  let tagged = 0;
  let deleted = 0;
  for (const id of generatedIds) {
    if (downloadedIds.has(id)) downloaded += 1;
    if (taggedIds.has(id)) tagged += 1;
    if (deletedIds.has(id)) deleted += 1;
  }
  return {
    generated,
    downloaded,
    tagged,
    deleted,
    downloadRate: generated > 0 ? downloaded / generated : 0,
    tagRate: generated > 0 ? tagged / generated : 0,
    keptRate: generated > 0 ? (generated - deleted) / generated : 0,
  };
}

/**
 * Prompt 模式对比：按 `generation.requested.payload.promptMode` 分组，计算每组
 * 的请求数、成功数、成功率与满意度（成功图里被下载或打标的占比）。
 *
 * 成功事件本身不带 promptMode，通过 messageId 关联回对应的 requested 事件。
 */
export function computePromptModeComparison(
  events: AnalyticsEvent[],
): PromptModeRow[] {
  // messageId -> promptMode（取该 message 首次 requested 的模式）
  const messagePromptMode = new Map<string, string>();
  const requestedByMode = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== GENERATION_REQUESTED) continue;
    const mode = payloadString(event, "promptMode") ?? "unknown";
    if (event.messageId && !messagePromptMode.has(event.messageId)) {
      messagePromptMode.set(event.messageId, mode);
    }
    // generate_another 等无 messageId 的 requested 也计入请求数（按 payload 取 mode）
    requestedByMode.set(mode, (requestedByMode.get(mode) ?? 0) + 1);
  }

  // 成功/满意度按 messageId 反查模式
  const succeededByMode = new Map<string, number>();
  const satisfiedByMode = new Map<string, number>();
  const downloadedImageIds = new Set<string>();
  const taggedImageIds = new Set<string>();
  for (const event of events) {
    if (event.eventName === IMAGE_DOWNLOADED && event.imageId) {
      downloadedImageIds.add(event.imageId);
    } else if (
      (event.eventName === IMAGE_TAG_COLOR_SET ||
        event.eventName === IMAGE_TAG_COLOR_CHANGED) &&
      event.imageId
    ) {
      taggedImageIds.add(event.imageId);
    }
  }
  for (const event of events) {
    if (event.eventName !== GENERATION_SUCCEEDED) continue;
    const mode = event.messageId
      ? (messagePromptMode.get(event.messageId) ?? "unknown")
      : "unknown";
    succeededByMode.set(mode, (succeededByMode.get(mode) ?? 0) + 1);
    if (
      event.imageId &&
      (downloadedImageIds.has(event.imageId) || taggedImageIds.has(event.imageId))
    ) {
      satisfiedByMode.set(mode, (satisfiedByMode.get(mode) ?? 0) + 1);
    }
  }

  const modes = new Set<string>([
    ...requestedByMode.keys(),
    ...succeededByMode.keys(),
  ]);
  const rows: PromptModeRow[] = [];
  for (const mode of modes) {
    const requested = requestedByMode.get(mode) ?? 0;
    const succeeded = succeededByMode.get(mode) ?? 0;
    const satisfied = satisfiedByMode.get(mode) ?? 0;
    rows.push({
      promptMode: mode,
      requested,
      succeeded,
      successRate: requested > 0 ? succeeded / requested : 0,
      satisfactionRate: succeeded > 0 ? satisfied / succeeded : 0,
    });
  }
  rows.sort((a, b) => b.requested - a.requested || a.promptMode.localeCompare(b.promptMode));
  return rows;
}

/** 事件名分布，按计数降序。 */
export function computeEventDistribution(
  events: AnalyticsEvent[],
): EventDistributionRow[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.eventName, (counts.get(event.eventName) ?? 0) + 1);
  }
  return Array.from(counts, ([eventName, count]) => ({ eventName, count })).sort(
    (a, b) => b.count - a.count || a.eventName.localeCompare(b.eventName),
  );
}

/**
 * 按天聚合生成请求/成功的时间序列，覆盖最近 `days` 天（含今天，无事件的日期补零）。
 * 无事件时返回空数组。
 */
export function computeTimeSeries(
  events: AnalyticsEvent[],
  days: number,
): TimeSeriesBucket[] {
  if (days <= 0 || events.length === 0) return [];
  const buckets = new Map<string, TimeSeriesBucket>();
  // 初始化最近 N 天的桶（本地日期，YYYY-MM-DD）。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const label = dateLabel(d);
    buckets.set(label, { date: label, requested: 0, succeeded: 0 });
  }
  for (const event of events) {
    if (
      event.eventName !== GENERATION_REQUESTED &&
      event.eventName !== GENERATION_SUCCEEDED
    ) {
      continue;
    }
    const ms = Date.parse(event.occurredAt);
    if (Number.isNaN(ms)) continue;
    const label = dateLabel(new Date(ms));
    const bucket = buckets.get(label);
    if (!bucket) continue; // 超出窗口的事件不计
    if (event.eventName === GENERATION_REQUESTED) bucket.requested += 1;
    else bucket.succeeded += 1;
  }
  return Array.from(buckets.values());
}

function dateLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 聚合全部指标，供面板一次性取用。 */
export function computeInsights(events: AnalyticsEvent[]): AnalyticsInsights {
  return {
    overview: computeOverview(events),
    funnel: computeGenerationFunnel(events),
    satisfaction: computeSatisfactionProxy(events),
    promptModes: computePromptModeComparison(events),
    topEvents: computeEventDistribution(events),
    timeSeries: computeTimeSeries(events, 14),
  };
}
