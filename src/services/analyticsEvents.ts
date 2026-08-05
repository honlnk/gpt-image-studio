import type { AnalyticsEvent } from "../types/studio";
import { STORE_NAMES, type StudioStorage } from "./storage";
import { resolveStorage } from "./storage/resolveStorage";

function timestampFromOccurredAt(record: { occurredAt?: string }) {
  if (!record.occurredAt) return 0;
  const timestamp = Date.parse(record.occurredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** 分析事件（analyticsEvents 表）的存储服务。阶段一 PR2 改工厂注入（决策 T1）。 */
export type AnalyticsEventServices = ReturnType<
  typeof createAnalyticsEventServices
>;

export function createAnalyticsEventServices(storage: StudioStorage) {
  const services = {
    async list() {
      const events = await storage.list<AnalyticsEvent>(
        STORE_NAMES.analyticsEvents,
      );
      return events.sort(
        (a, b) => timestampFromOccurredAt(a) - timestampFromOccurredAt(b),
      );
    },
    saveBatch(events: AnalyticsEvent[]) {
      return Promise.all(
        events.map((event) =>
          storage.put<AnalyticsEvent>(STORE_NAMES.analyticsEvents, event),
        ),
      );
    },
    clear() {
      return storage.clear(STORE_NAMES.analyticsEvents);
    },
    async exportJson() {
      const events = await services.list();
      return events.map((event) => JSON.stringify(event)).join("\n");
    },
  };
  return services;
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultServices = createAnalyticsEventServices(resolveStorage());

export async function listAnalyticsEvents() {
  return defaultServices.list();
}

export function saveAnalyticsEventsBatch(events: AnalyticsEvent[]) {
  return defaultServices.saveBatch(events);
}

export function clearAnalyticsEvents() {
  return defaultServices.clear();
}

export async function exportAnalyticsEventsJson() {
  return defaultServices.exportJson();
}
