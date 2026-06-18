import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent, Conversation } from "../types/studio";
import { createAnalyticsExportArchive } from "./analyticsExport";
import { STORE_NAMES } from "./db";

const mocks = vi.hoisted(() => ({
  getAllFromStore: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAllFromStore: mocks.getAllFromStore,
  };
});

vi.mock("./conversations", () => ({
  listConversations: mocks.listConversations,
}));

function makeEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    id: "ev-1",
    eventName: "chat.submit",
    occurredAt: "2026-06-17T00:00:00.000Z",
    sessionId: "sess-1",
    source: "ui_click",
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    title: "测试会话",
    summary: "",
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...overrides,
  };
}

/** 复制自 backups.test.ts 的本地文件头解析器，返回 文件名 → Blob。 */
async function readLocalZipFiles(zip: Blob) {
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, Blob>();
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(
      new Uint8Array(buffer, nameStart, filenameLength),
    );

    files.set(name, new Blob([buffer.slice(dataStart, dataEnd)]));
    offset = dataEnd;
  }

  return files;
}

async function readText(files: Map<string, Blob>, name: string) {
  const blob = files.get(name);
  if (!blob) throw new Error(`missing zip entry: ${name}`);
  return blob.text();
}

async function readJson<T>(files: Map<string, Blob>, name: string) {
  return JSON.parse(await readText(files, name)) as T;
}

describe("analyticsExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listConversations.mockResolvedValue([]);
  });

  it("produces a zip with the standard file layout for empty events", async () => {
    mocks.getAllFromStore.mockResolvedValue([]);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    expect(mocks.getAllFromStore).toHaveBeenCalledWith(
      STORE_NAMES.analyticsEvents,
    );
    expect(files.has("manifest.json")).toBe(true);
    expect(files.has("README.md")).toBe(true);
    expect(files.has("events/raw/events.jsonl")).toBe(true);
    expect(files.has("reports/summary.md")).toBe(true);

    const manifest = await readJson<{
      app: string;
      version: number;
      eventCount: number;
      shards: unknown[];
      conversationShards: unknown[];
    }>(files, "manifest.json");
    expect(manifest.app).toBe("gpt-image-studio");
    expect(manifest.version).toBe(1);
    expect(manifest.eventCount).toBe(0);
    expect(manifest.shards).toEqual([]);
    expect(manifest.conversationShards).toEqual([]);

    // 空事件不应产生任何分片
    const timelineFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/timeline/"),
    );
    expect(timelineFiles).toEqual([]);
    const conversationFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/conversations/"),
    );
    expect(conversationFiles).toEqual([]);
  });

  it("emits a single timeline shard for a small same-window batch", async () => {
    const events = [
      makeEvent({ id: "ev-1", occurredAt: "2026-06-17T00:00:00.000Z" }),
      makeEvent({
        id: "ev-2",
        eventName: "image.downloaded",
        occurredAt: "2026-06-17T01:00:00.000Z",
      }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    const timelineFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/timeline/"),
    );
    expect(timelineFiles).toHaveLength(1);
    expect(timelineFiles[0]).toMatch(/_part-001\.md$/);

    const shard = await readText(files, timelineFiles[0]);
    expect(shard).toContain("event_count: 2");
    expect(shard).toContain("part: 1");
    expect(shard).toContain("total_parts: 1");
    expect(shard).toContain("chat.submit");
    expect(shard).toContain("image.downloaded");
  });

  it("splits events crossing the 7-day window into multiple shards", async () => {
    const events = [
      makeEvent({ id: "ev-1", occurredAt: "2026-06-01T00:00:00.000Z" }),
      makeEvent({ id: "ev-2", occurredAt: "2026-06-02T00:00:00.000Z" }),
      makeEvent({ id: "ev-3", occurredAt: "2026-06-15T00:00:00.000Z" }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    const timelineFiles = [...files.keys()]
      .filter((name) => name.startsWith("reports/timeline/"))
      .sort();
    expect(timelineFiles).toHaveLength(2);
    expect(timelineFiles[0]).toMatch(/_part-001\.md$/);
    expect(timelineFiles[1]).toMatch(/_part-002\.md$/);

    const manifest = await readJson<{
      eventCount: number;
      shards: { part: number; totalParts: number; eventCount: number }[];
    }>(files, "manifest.json");
    expect(manifest.eventCount).toBe(3);
    expect(manifest.shards).toHaveLength(2);
    expect(manifest.shards[0].totalParts).toBe(2);
    expect(manifest.shards[1].totalParts).toBe(2);
  });

  it("splits a large same-window batch by event-count into multiple parts", async () => {
    const events = Array.from({ length: 1001 }, (_, index) =>
      makeEvent({
        id: `ev-${index + 1}`,
        occurredAt: "2026-06-17T00:00:00.000Z",
      }),
    );
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    const timelineFiles = [...files.keys()]
      .filter((name) => name.startsWith("reports/timeline/"))
      .sort();
    expect(timelineFiles).toHaveLength(2);

    const manifest = await readJson<{
      shards: { eventCount: number; part: number }[];
    }>(files, "manifest.json");
    expect(manifest.shards[0].eventCount).toBe(1000);
    expect(manifest.shards[1].eventCount).toBe(1);
  });

  it("keeps events.jsonl consistent with listAnalyticsEvents", async () => {
    const events = [
      makeEvent({ id: "ev-1", occurredAt: "2026-06-17T00:00:00.000Z" }),
      makeEvent({ id: "ev-2", occurredAt: "2026-06-17T01:00:00.000Z" }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    const jsonl = await readText(files, "events/raw/events.jsonl");
    expect(jsonl).toBe(events.map((e) => JSON.stringify(e)).join("\n"));
  });

  it("summary contains event distribution and shard navigation", async () => {
    const events = [
      makeEvent({ id: "ev-1", eventName: "chat.submit" }),
      makeEvent({ id: "ev-2", eventName: "chat.submit" }),
      makeEvent({ id: "ev-3", eventName: "image.downloaded" }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);
    const summary = await readText(files, "reports/summary.md");

    expect(summary).toContain("event_count: 3");
    expect(summary).toContain("chat.submit");
    expect(summary).toContain("image.downloaded");
    expect(summary).toMatch(/reports\/timeline\/.*part-001/);
  });

  it("produces a conversation shard per conversationId with resolved title", async () => {
    const conversation = makeConversation({ id: "conv-abc", title: "我的创作" });
    mocks.listConversations.mockResolvedValue([conversation]);
    const events = [
      makeEvent({
        id: "ev-1",
        conversationId: "conv-abc",
        occurredAt: "2026-06-17T00:00:00.000Z",
      }),
      makeEvent({
        id: "ev-2",
        conversationId: "conv-abc",
        eventName: "image.downloaded",
        occurredAt: "2026-06-17T01:00:00.000Z",
      }),
      // 无 conversationId 的事件不应进入会话分片
      makeEvent({ id: "ev-3", occurredAt: "2026-06-17T02:00:00.000Z" }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);

    const conversationFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/conversations/"),
    );
    expect(conversationFiles).toHaveLength(1);
    expect(conversationFiles[0]).toMatch(/^reports\/conversations\/conversation_conv-abc_part-001\.md$/);

    const shard = await readText(files, conversationFiles[0]);
    expect(shard).toContain("conversation_id: \"conv-abc\"");
    expect(shard).toContain("title: \"我的创作\"");
    expect(shard).toContain("event_count: 2");
    expect(shard).toContain("chat.submit");
  });

  it("falls back to placeholder title for deleted conversations", async () => {
    mocks.listConversations.mockResolvedValue([]);
    const events = [
      makeEvent({
        id: "ev-1",
        conversationId: "conv-gone",
        occurredAt: "2026-06-17T00:00:00.000Z",
      }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);
    const conversationFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/conversations/"),
    );
    expect(conversationFiles).toHaveLength(1);

    const shard = await readText(files, conversationFiles[0]);
    expect(shard).toContain("title: \"(已删除会话)\"");
  });

  it("summary includes a color-tagging section with action and color distribution", async () => {
    const events = [
      makeEvent({
        id: "ev-1",
        eventName: "image.tag_color_set",
        payload: { imageId: "img-1", previousColor: null, newColor: "red", entry: "details" },
      }),
      makeEvent({
        id: "ev-2",
        eventName: "image.tag_color_changed",
        payload: { imageId: "img-1", previousColor: "red", newColor: "blue", entry: "details" },
      }),
      makeEvent({
        id: "ev-3",
        eventName: "library.filter_by_tag_color",
        payload: { color: "red" },
      }),
    ];
    mocks.getAllFromStore.mockResolvedValue(events);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);
    const summary = await readText(files, "reports/summary.md");

    expect(summary).toContain("## 颜色分组行为");
    // 操作分布
    expect(summary).toContain("image.tag_color_set");
    expect(summary).toContain("image.tag_color_changed");
    expect(summary).toContain("library.filter_by_tag_color");
    // 颜色分布：red 出现在 set + filter，blue 出现在 changed
    expect(summary).toContain("| red |");
    expect(summary).toContain("| blue |");
  });

  it("shows no-color section when no color events exist", async () => {
    mocks.getAllFromStore.mockResolvedValue([
      makeEvent({ id: "ev-1", eventName: "chat.submit" }),
    ]);

    const zip = await createAnalyticsExportArchive();
    const files = await readLocalZipFiles(zip);
    const summary = await readText(files, "reports/summary.md");

    expect(summary).toContain("## 颜色分组行为");
    expect(summary).toContain("暂无颜色分组相关事件");
  });
});
