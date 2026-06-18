import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "../types/studio";
import { createAnalyticsExportArchive } from "./analyticsExport";
import { STORE_NAMES } from "./db";

const mocks = vi.hoisted(() => ({
  getAllFromStore: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAllFromStore: mocks.getAllFromStore,
  };
});

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
    }>(files, "manifest.json");
    expect(manifest.app).toBe("gpt-image-studio");
    expect(manifest.version).toBe(1);
    expect(manifest.eventCount).toBe(0);
    expect(manifest.shards).toEqual([]);

    // 空事件不应产生任何 timeline 分片
    const timelineFiles = [...files.keys()].filter((name) =>
      name.startsWith("reports/timeline/"),
    );
    expect(timelineFiles).toEqual([]);
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
    // YAML frontmatter 字段
    expect(shard).toContain("event_count: 2");
    expect(shard).toContain("part: 1");
    expect(shard).toContain("total_parts: 1");
    // 事件明细
    expect(shard).toContain("chat.submit");
    expect(shard).toContain("image.downloaded");
  });

  it("splits events crossing the 7-day window into multiple shards", async () => {
    const events = [
      makeEvent({ id: "ev-1", occurredAt: "2026-06-01T00:00:00.000Z" }),
      makeEvent({ id: "ev-2", occurredAt: "2026-06-02T00:00:00.000Z" }),
      // 跨过 7 天窗口
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
    // 1001 条同窗口事件，应切成 2 个 part（1000 + 1）
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
    // 分片导航引用了 timeline 文件名
    expect(summary).toMatch(/reports\/timeline\/.*part-001/);
  });
});
