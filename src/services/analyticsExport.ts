import type { AnalyticsEvent, Conversation } from "../types/studio";
import { t } from "../i18n";
import { listAnalyticsEvents } from "./analyticsEvents";
import { listConversations } from "./conversations";
import { createZipArchive } from "./zipArchive";

// §11.3 默认分片阈值（V1.1 不进设置，硬编码）
const SHARD_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const SHARD_MAX_EVENTS = 1000;
const SHARD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXPORT_VERSION = 1;
const APP_NAME = "gpt-image-studio";

const COLOR_EVENT_PREFIX = "image.tag_color_";
const COLOR_FILTER_EVENT = "library.filter_by_tag_color";

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

type ConversationShard = {
  meta: ShardMeta;
  conversationId: string;
  title: string;
  events: AnalyticsEvent[];
};

type AnalyticsManifest = {
  app: string;
  version: number;
  exportedAt: string;
  eventCount: number;
  timeRange: { start: string; end: string };
  shards: ShardMeta[];
  /** 会话级分片索引（V1.2） */
  conversationShards?: ShardMeta[];
};

/**
 * 构建分析日志导出包：ZIP 内含 manifest.json、README.md、events/raw/events.jsonl、
 * reports/summary.md、reports/timeline/*.md（按 7 天窗口 + 条数/体积兜底分片）、
 * reports/conversations/*.md（会话级分片，V1.2）。
 */
export async function createAnalyticsExportArchive(): Promise<Blob> {
  const [events, conversations] = await Promise.all([
    listAnalyticsEvents(),
    listConversations().catch(() => [] as Conversation[]),
  ]);
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );

  const exportedAt = new Date().toISOString();
  const timeRange = computeTimeRange(events);
  const shards = shardEvents(events);
  const conversationShards = shardEventsByConversation(events, conversationById);
  const manifest: AnalyticsManifest = {
    app: APP_NAME,
    version: EXPORT_VERSION,
    exportedAt,
    eventCount: events.length,
    timeRange,
    shards: shards.map((shard) => shard.meta),
    conversationShards: conversationShards.map((shard) => shard.meta),
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
      buildSummary(events, shards, conversationShards, manifest),
      "text/markdown",
    ),
    ...shards.map((shard) =>
      textEntry(shard.meta.name, buildTimelineShard(shard), "text/markdown"),
    ),
    ...conversationShards.map((shard) =>
      textEntry(
        shard.meta.name,
        buildConversationShard(shard),
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
  const parts = splitBySizeAndCount(windowGroups);

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

/**
 * 会话级分片：按 conversationId 分组，每个会话一个分片（超 1000 条兜底切 part）。
 * 无 conversationId 的事件不产生会话分片。
 */
function shardEventsByConversation(
  events: AnalyticsEvent[],
  conversationById: Map<string, Conversation>,
): ConversationShard[] {
  const grouped = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    if (!event.conversationId) continue;
    const bucket = grouped.get(event.conversationId) ?? [];
    bucket.push(event);
    grouped.set(event.conversationId, bucket);
  }

  const shards: ConversationShard[] = [];
  for (const [conversationId, groupEvents] of grouped) {
    const conversation = conversationById.get(conversationId);
    const title = conversation?.title ?? t("settings.analytics.report.deletedConversation");
    const parts = splitBySizeAndCount([groupEvents]);
    parts.forEach((partEvents, index) => {
      const part = index + 1;
      const partNumber = String(part).padStart(3, "0");
      const shortId = conversationId.slice(0, 12);
      shards.push({
        conversationId,
        title,
        events: partEvents,
        meta: {
          name: `reports/conversations/conversation_${shortId}_part-${partNumber}.md`,
          part,
          totalParts: parts.length,
          timeRange: {
            start: partEvents[0].occurredAt,
            end: partEvents[partEvents.length - 1].occurredAt,
          },
          eventCount: partEvents.length,
        },
      });
    });
  }
  return shards;
}

/** 将多组事件按条数/体积阈值切成 part（组间保留边界，不合并跨组事件）。 */
function splitBySizeAndCount(groups: AnalyticsEvent[][]): AnalyticsEvent[][] {
  const parts: AnalyticsEvent[][] = [];
  for (const group of groups) {
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
  return parts;
}

function buildReadme(manifest: AnalyticsManifest): string {
  return [
    `# ${t("settings.analytics.report.readmeTitle")}`,
    "",
    t("settings.analytics.report.readmeIntro"),
    "",
    `## ${t("settings.analytics.report.fileStructureTitle")}`,
    "",
    `- \`manifest.json\` — ${t("settings.analytics.report.manifestEntry")}`,
    `- \`events/raw/events.jsonl\` — ${t("settings.analytics.report.eventsEntry")}`,
    `- \`reports/summary.md\` — ${t("settings.analytics.report.summaryEntry")}`,
    `- \`reports/timeline/*.md\` — ${t("settings.analytics.report.timelineEntry", { count: manifest.shards.length })}`,
    `- \`reports/conversations/*.md\` — ${t("settings.analytics.report.conversationsEntry", { count: manifest.conversationShards?.length ?? 0 })}`,
    "",
    `## ${t("settings.analytics.report.metaTitle")}`,
    "",
    `- ${t("settings.analytics.report.exportedAt", { value: manifest.exportedAt })}`,
    `- ${t("settings.analytics.report.eventTotal", { count: manifest.eventCount })}`,
    `- ${t("settings.analytics.report.timeRange", { start: manifest.timeRange.start, end: manifest.timeRange.end })}`,
    `- ${t("settings.analytics.report.timelineShardCount", { count: manifest.shards.length })}`,
    `- ${t("settings.analytics.report.conversationShardCount", { count: manifest.conversationShards?.length ?? 0 })}`,
    "",
    `> ${t("settings.analytics.report.consistencyNote")}`,
    "",
  ].join("\n");
}

function buildSummary(
  events: AnalyticsEvent[],
  shards: Shard[],
  conversationShards: ConversationShard[],
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
        `- [${shard.meta.name}](${shard.meta.name}) — ${t("settings.analytics.report.timelineNavEntry", {
          part: shard.meta.part,
          total: shard.meta.totalParts,
          count: shard.meta.eventCount,
          start: shard.meta.timeRange.start,
          end: shard.meta.timeRange.end,
        })}`,
    )
    .join("\n");

  const conversationNav = conversationShards
    .map(
      (shard) =>
        `- [${shard.meta.name}](${shard.meta.name}) — ${t("settings.analytics.report.conversationNavEntry", {
          title: shard.title,
          count: shard.meta.eventCount,
        })}`,
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
    `conversation_shard_count: ${conversationShards.length}`,
    "---",
    "",
    `# ${t("settings.analytics.report.summaryTitle")}`,
    "",
    `## ${t("settings.analytics.report.overviewTitle")}`,
    "",
    `- ${t("settings.analytics.report.eventTotal", { count: manifest.eventCount })}`,
    `- ${t("settings.analytics.report.sessionCount", { count: sessionCount })}`,
    `- ${t("settings.analytics.report.conversationCount", { count: conversationCount })}`,
    `- ${t("settings.analytics.report.timeRange", { start: manifest.timeRange.start, end: manifest.timeRange.end })}`,
    "",
    `## ${t("settings.analytics.report.eventDistributionTitle")}`,
    "",
    `| ${t("settings.analytics.report.colEventName")} | ${t("settings.analytics.report.colCount")} |`,
    "| --- | --- |",
    topEvents || `| ${t("settings.analytics.report.emptyCell")} | 0 |`,
    "",
    buildColorSection(events),
    "",
    `## ${t("settings.analytics.report.timelineNavTitle")}`,
    "",
    shardNav || t("settings.analytics.report.noShards"),
    "",
    `## ${t("settings.analytics.report.conversationNavTitle")}`,
    "",
    conversationNav || t("settings.analytics.report.noConversationShards"),
    "",
  ].join("\n");
}

/** 颜色分组行为专题段：统计 tag_color_* 与 filter_by_tag_color 事件，按颜色分布。 */
function buildColorSection(events: AnalyticsEvent[]): string {
  const colorTagEvents = events.filter(
    (event) =>
      event.eventName.startsWith(COLOR_EVENT_PREFIX) ||
      event.eventName === COLOR_FILTER_EVENT,
  );
  if (!colorTagEvents.length) {
    return [
      `## ${t("settings.analytics.report.colorSectionTitle")}`,
      "",
      t("settings.analytics.report.noColorEvents"),
      "",
    ].join("\n");
  }

  const actionCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();
  for (const event of colorTagEvents) {
    actionCounts.set(
      event.eventName,
      (actionCounts.get(event.eventName) ?? 0) + 1,
    );
    const color = readColorFromPayload(event);
    if (color) {
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
    }
  }

  const actionRows = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join("\n");
  const colorRows = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color, count]) => `| ${color} | ${count} |`)
    .join("\n");

  return [
    `## ${t("settings.analytics.report.colorSectionTitle")}`,
    "",
    `### ${t("settings.analytics.report.actionDistributionTitle")}`,
    "",
    `| ${t("settings.analytics.report.colEvent")} | ${t("settings.analytics.report.colCount")} |`,
    "| --- | --- |",
    actionRows,
    "",
    `### ${t("settings.analytics.report.colorDistributionTitle")}`,
    "",
    `| ${t("settings.analytics.report.colColor")} | ${t("settings.analytics.report.colCount")} |`,
    "| --- | --- |",
    colorRows || `| ${t("settings.analytics.report.emptyCell")} | 0 |`,
    "",
  ].join("\n");
}

function readColorFromPayload(event: AnalyticsEvent): string | undefined {
  if (!event.payload) return undefined;
  // tag_color_* 用 newColor，filter_by_tag_color 用 color
  const color = (event.payload.newColor ?? event.payload.color) as
    | string
    | null
    | undefined;
  return color ?? undefined;
}

function formatEventLine(event: AnalyticsEvent): string {
  const ctx: string[] = [];
  if (event.conversationId) ctx.push(`conv=${event.conversationId}`);
  if (event.messageId) ctx.push(`msg=${event.messageId}`);
  if (event.imageId) ctx.push(`img=${event.imageId}`);
  const payload =
    event.payload && Object.keys(event.payload).length
      ? ` ${JSON.stringify(event.payload)}`
      : "";
  return `- \`${event.occurredAt}\` **${event.eventName}** [${event.source}]${ctx.length ? ` {${ctx.join(", ")}}` : ""}${payload}`;
}

function buildTimelineShard(shard: Shard): string {
  const { meta, events } = shard;
  const sessionCount = new Set(events.map((e) => e.sessionId)).size;
  const conversationCount = new Set(
    events.map((e) => e.conversationId).filter(Boolean),
  ).size;

  const lines = events.map(formatEventLine);

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
    `# ${t("settings.analytics.report.timelineShardTitle", { part: meta.part, total: meta.totalParts })}`,
    "",
    t("settings.analytics.report.timelineShardCoverage", {
      start: meta.timeRange.start,
      end: meta.timeRange.end,
      count: meta.eventCount,
    }),
    "",
    ...lines,
    "",
  ].join("\n");
}

function buildConversationShard(shard: ConversationShard): string {
  const { meta, events, conversationId, title } = shard;
  const sessionCount = new Set(events.map((e) => e.sessionId)).size;

  const lines = events.map(formatEventLine);

  return [
    "---",
    `conversation_id: "${conversationId}"`,
    `title: "${title}"`,
    `time_range: ${meta.timeRange.start} ~ ${meta.timeRange.end}`,
    `event_count: ${meta.eventCount}`,
    `session_count: ${sessionCount}`,
    `part: ${meta.part}`,
    `total_parts: ${meta.totalParts}`,
    "---",
    "",
    `# ${t("settings.analytics.report.conversationShardTitle", { title })}`,
    "",
    `- ${t("settings.analytics.report.conversationIdLabel", { id: `\`${conversationId}\`` })}`,
    `- ${t("settings.analytics.report.timeRange", { start: meta.timeRange.start, end: meta.timeRange.end })}`,
    `- ${t("settings.analytics.report.eventCountLabel", { count: meta.eventCount })}`,
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
