import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "../types/studio";
import {
  createSpyStorage,
  type SpyStorage,
} from "./storage/createSpyStorage";

const spyStorage: SpyStorage = createSpyStorage();

vi.mock("./storage/resolveStorage", () => ({
  resolveStorage: () => spyStorage,
}));

const {
  clearAnalyticsEvents,
  exportAnalyticsEventsJson,
  listAnalyticsEvents,
  saveAnalyticsEventsBatch,
} = await import("./analyticsEvents");
const { STORE_NAMES } = await import("./storage");

const event: AnalyticsEvent = {
  id: "ev-1",
  eventName: "chat.submit",
  occurredAt: "2026-06-17T00:00:00.000Z",
  sessionId: "sess-1",
  source: "ui_click",
};

describe("analyticsEvents service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists events sorted by occurredAt ascending", async () => {
    const later: AnalyticsEvent = {
      ...event,
      id: "ev-2",
      occurredAt: "2026-06-17T01:00:00.000Z",
    };
    spyStorage.list.mockResolvedValue([later, event]);

    const result = await listAnalyticsEvents();

    expect(spyStorage.list).toHaveBeenCalledWith(STORE_NAMES.analyticsEvents);
    expect(result.map((item) => item.id)).toEqual(["ev-1", "ev-2"]);
  });

  it("saves a batch of events", async () => {
    await saveAnalyticsEventsBatch([event]);

    expect(spyStorage.put).toHaveBeenCalledWith(
      STORE_NAMES.analyticsEvents,
      event,
    );
  });

  it("clears all events", async () => {
    await clearAnalyticsEvents();

    expect(spyStorage.clear).toHaveBeenCalledWith(STORE_NAMES.analyticsEvents);
  });

  it("exports events as JSONL string", async () => {
    spyStorage.list.mockResolvedValue([event]);

    const result = await exportAnalyticsEventsJson();

    expect(result).toBe(JSON.stringify(event));
  });
});
