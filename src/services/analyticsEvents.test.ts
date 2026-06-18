import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "../types/studio";
import {
  clearAnalyticsEvents,
  exportAnalyticsEventsJson,
  listAnalyticsEvents,
  saveAnalyticsEventsBatch,
} from "./analyticsEvents";
import { STORE_NAMES } from "./db";

const mocks = vi.hoisted(() => ({
  clearStore: vi.fn(),
  getAllFromStore: vi.fn(),
  putInStore: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    clearStore: mocks.clearStore,
    getAllFromStore: mocks.getAllFromStore,
    putInStore: mocks.putInStore,
  };
});

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
    mocks.getAllFromStore.mockResolvedValue([later, event]);

    const result = await listAnalyticsEvents();

    expect(mocks.getAllFromStore).toHaveBeenCalledWith(
      STORE_NAMES.analyticsEvents,
    );
    expect(result.map((item) => item.id)).toEqual(["ev-1", "ev-2"]);
  });

  it("saves a batch of events", async () => {
    mocks.putInStore.mockResolvedValue(undefined);

    await saveAnalyticsEventsBatch([event]);

    expect(mocks.putInStore).toHaveBeenCalledWith(
      STORE_NAMES.analyticsEvents,
      event,
    );
  });

  it("clears all events", async () => {
    mocks.clearStore.mockResolvedValue(undefined);

    await clearAnalyticsEvents();

    expect(mocks.clearStore).toHaveBeenCalledWith(STORE_NAMES.analyticsEvents);
  });

  it("exports events as JSONL string", async () => {
    mocks.getAllFromStore.mockResolvedValue([event]);

    const result = await exportAnalyticsEventsJson();

    expect(result).toBe(JSON.stringify(event));
  });
});
