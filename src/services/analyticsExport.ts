import type { AnalyticsEvent } from "../types/studio";
import { listAnalyticsEvents } from "./analyticsEvents";
import { createZipArchive } from "./zipArchive";

// §11.3 默认分片阈值（V1.1 不进设置，硬编码）
const SHARD_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SHARD_MAX_EVENTS = 1000;
const SHARD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXPORT_VERSION = 1;
const APP_NAME = "gpt-image-studio";

type ShardMeta = {
  /** 分片文件名（相对路径，如 reports/timeline/timeline_..._part-001.md） */
  name: string;
  /** 1-based 分片序号 */
  part: number;
  totalParts: number;
  /** 分片覆盖的时间范围（ISO） */
  timeRange: { start: string; end: string };
  /** 分片内事件数 */
  eventCount: number;
};

type Shard = {
  meta: ShardMeta;
  events: AnalyticsEvent[];
};

type AnalyticsManifest = {
  app: string;
  version: number;
  exportedAt: string;
  eventCount: number;
  timeRange: { start: string; end: string };
  shards: ShardMeta[];
};

/**
 * 构建分析日志导出包：ZIP 内含 manifest.json、README.md、events/raw/events.jsonl、
 * reports/summary.md、reports/timeline/*.md（按 7 天窗口 + 条数/体积兜底分片）。
 */
export async function createAnalyticsExportArchive(): Promise<Blob> {
  const events = await listAnalyticsEvents();
  const exportedAt = new Date().toISOString();
  const timeRange = computeTimeRange(events);
  const shards = shardEvents(events);
  const manifest: AnalyticsManifest = {
    app: APP_NAME,
    version: EXPORT_VERSION,
    exportedAt,
    eventCount: events.length,
    timeRange,
    shards: shards.map((shard) => shard.meta),
  };

  const entries = [
    jsonEntry("manifest.json", manifest),
    textEntry("README.md", buildReadme(manifest), "text/markdown"),
    textEntry(
      "events/raw/events.jsonl",
      events.map((event) => JSON.stringify(event)).join("\n"),
      "application/x-ndjson",
    ),
    textEntry(
      "reports/summary.md",
      buildSummary(events, shards, manifest),
      "text/markdown",
    ),
    ...shards.map((shard) =>
      textEntry(
        shard.meta.name,
        buildTimelineShard(shard),
        "text/markdown",
      ),
    ),
  ];

  return createZipArchive(entries);
}

function computeTimeRange(events: AnalyticsEvent[]) {
  if (!events.length) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  const timestamps = events.map((event) => Date.parse(event.occurredAt));
  return {
    start: new Date(Math.min(...timestamps)).toISOString(),
    end: new Date(Math.max(...timestamps)).toISOString(),
  };
}

/**
 * 分片算法（§11.3）：
 * 1. 先按 7 天滑动窗口分组（从第一个事件起，累加直到下个事件超出窗口）。
 * 2. 组内若超过 1000 events 或 JSON 体积超过 2 MB，再切 part。
 * 输出线性 shard 列表，part 序号在全部 shard 中全局递增。
 */
function shardEvents(events: AnalyticsEvent[]): Shard[] {
  if (!events.length) return [];

  // 第一步：按 7 天窗口分组
  const windowGroups: AnalyticsEvent[][] = [];
  let currentGroup: AnalyticsEvent[] = [];
  let windowStart = Date.parse(events[0].occurredAt);

  for (const event of events) {
    const ts = Date.parse(event.occurredAt);
    if (ts - windowStart > SHARD_TIME_WINDOW_MS && currentGroup.length) {
      windowGroups.push(currentGroup);
      currentGroup = [];
      windowStart = ts;
    }
    currentGroup.push(event);
  }
  if (currentGroup.length) windowGroups.push(currentGroup);

  // 第二步：每组内按条数/体积切 part
  const parts: AnalyticsEvent[][] = [];
  for (const group of windowGroups) {
    let chunk: AnalyticsEvent[] = [];
    let chunkBytes = 0;
    for (const event of group) {
      const eventBytes = new TextEncoder().encode(
        JSON.stringify(event),
      ).byteLength;
      const exceedsCount = chunk.length + 1 > SHARD_MAX_EVENTS;
      const exceedsBytes = chunkBytes + eventBytes > SHARD_MAX_BYTES;
      if ((exceedsCount || exceedsBytes) && chunk.length) {
        parts.push(chunk);
        chunk = [];
        chunkBytes = 0;
      }
      chunk.push(event);
      chunkBytes += eventBytes;
    }
    if (chunk.length) parts.push(chunk);
  }

  const totalParts = parts.length;
  return parts.map((partEvents, index) => {
    const part = index + 1;
    const partNumber = String(part).padStart(3, "0");
    const start = new Date(
      Math.min(...partEvents.map((e) => Date.parse(e.occurredAt))),
    )
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 10);
    const end = new Date(
      Math.max(...partEvents.map((e) => Date.parse(e.occurredAt))),
    )
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 10);
    return {
      meta: {
        name: `reports/timeline/timeline_${start}_to_${end}_part-${partNumber}.md`,
        part,
        totalParts,
        timeRange: {
          start: partEvents[0].occurredAt,
          end: partEvents[partEvents.length - 1].occurredAt,
        },
        eventCount: partEvents.length,
      },
      events: partEvents,
    };
  });
}

function buildReadme(manifest: AnalyticsManifest): string {
  return [
    "# 行为日志导出",
    "",
    "本导出包为本地优先的行为日志快照，不包含远程上报。",
    "",
    "## 文件结构",
    "",
    "- `manifest.json` — 导出范围、版本、分片索引与校验信息。",
    "- `events/raw/events.jsonl` — 完整原始事件流（唯一事实源）。",
    "- `reports/summary.md` — 总览统计与分片导航。",
    `- \`reports/timeline/*.md\` — 时间线分片明细（共 ${manifest.shards.length} 片）。`,
    "",
    "## 元信息",
    "",
    `- 导出时间：${manifest.exportedAt}`,
    `- 事件总数：${manifest.eventCount}`,
    `- 时间范围：${manifest.timeRange.start} ~ ${manifest.timeRange.end}`,
    `- 分片数：${manifest.shards.length}`,
    "",
    "> JSON 与 Markdown 基于同一批事件生成，统计口径一致。",
    "",
  ].join("\n");
}

function buildSummary(
  events: AnalyticsEvent[],
  shards: Shard[],
  manifest: AnalyticsManifest,
): string {
  const sessionCount = new Set(events.map((e) => e.sessionId)).size;
  const conversationCount = new Set(
    events.map((e) => e.conversationId).filter(Boolean),
  ).size;

  const eventNameCounts = new Map<string, number>();
  for (const event of events) {
    eventNameCounts.set(
      event.eventName,
      (eventNameCounts.get(event.eventName) ?? 0) + 1,
    );
  }
  const topEvents = [...eventNameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join("\n");

  const shardNav = shards
    .map(
      (shard) =>
        `- [${shard.meta.name}](${shard.meta.name}) — part ${shard.meta.part}/${shard.meta.totalParts}，${shard.meta.eventCount} 条，${shard.meta.timeRange.start} ~ ${shard.meta.timeRange.end}`,
    )
    .join("\n");

  return [
    "---",
    `exported_at: "${manifest.exportedAt}"`,
    `event_count: ${manifest.eventCount}`,
    `session_count: ${sessionCount}`,
    `conversation_count: ${conversationCount}`,
    `time_range: ${manifest.timeRange.start} ~ ${manifest.timeRange.end}`,
    `shard_count: ${shards.length}`,
    "---",
    "",
    "# 行为日志总览",
    "",
    "## 概况",
    "",
    `- 事件总数：${manifest.eventCount}`,
    `- 会话（session）数：${sessionCount}`,
    `- 对话（conversation）数：${conversationCount}`,
    `- 时间范围：${manifest.timeRange.start} ~ ${manifest.timeRange.end}`,
    "",
    "## 事件分布",
    "",
    "| 事件名 | 次数 |",
    "| --- | --- |",
    topEvents || "| (无) | 0 |",
    "",
    "## 时间线分片导航",
    "",
    shardNav || "(无分片)",
    "",
  ].join("\n");
}

function buildTimelineShard(shard: Shard): string {
  const { meta, events } = shard;
  const sessionCount = new Set(events.map((e) => e.sessionId)).size;
  const conversationCount = new Set(
    events.map((e) => e.conversationId).filter(Boolean),
  ).size;

  const lines = events.map((event) => {
    const ctx: string[] = [];
    if (event.conversationId) ctx.push(`conv=${event.conversationId}`);
    if (event.messageId) ctx.push(`msg=${event.messageId}`);
    if (event.imageId) ctx.push(`img=${event.imageId}`);
    const payload =
      event.payload && Object.keys(event.payload).length
        ? ` ${JSON.stringify(event.payload)}`
        : "";
    return `- \`${event.occurredAt}\` **${event.eventName}** [${event.source}]${ctx.length ? ` {${ctx.join(", ")}}` : ""}${payload}`;
  });

  return [
    "---",
    `time_range: ${meta.timeRange.start} ~ ${meta.timeRange.end}`,
    `event_count: ${meta.eventCount}`,
    `session_count: ${sessionCount}`,
    `conversation_count: ${conversationCount}`,
    `part: ${meta.part}`,
    `total_parts: ${meta.totalParts}`,
    "---",
    "",
    `# 时间线明细（part ${meta.part}/${meta.totalParts}）`,
    "",
    `覆盖范围：${meta.timeRange.start} ~ ${meta.timeRange.end}，共 ${meta.eventCount} 条事件。`,
    "",
    ...lines,
    "",
  ].join("\n");
}

function jsonEntry(name: string, value: unknown) {
  return {
    name,
    blob: new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  };
}

function textEntry(name: string, content: string, mime: string) {
  return { name, blob: new Blob([content], { type: mime }) };
}
