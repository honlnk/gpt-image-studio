import type { AnalyticsEvent } from "../types/studio";
import {
  clearStore,
  getAllFromStore,
  putInStore,
  STORE_NAMES,
} from "./db";

function timestampFromOccurredAt(record: { occurredAt?: string }) {
  if (!record.occurredAt) return 0;
  const timestamp = Date.parse(record.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function listAnalyticsEvents() {
  const events = await getAllFromStore<AnalyticsEvent>(
    STORE_NAMES.analyticsEvents,
  );
  return events.sort(
    (a, b) => timestampFromOccurredAt(a) - timestampFromOccurredAt(b),
  );
}

export function saveAnalyticsEventsBatch(events: AnalyticsEvent[]) {
  return Promise.all(
    events.map((event) =>
      putInStore<AnalyticsEvent>(STORE_NAMES.analyticsEvents, event),
    ),
  );
}

export function clearAnalyticsEvents() {
  return clearStore(STORE_NAMES.analyticsEvents);
}

export async function exportAnalyticsEventsJson() {
  const events = await listAnalyticsEvents();
  return events.map((event) => JSON.stringify(event)).join("\n");
}
