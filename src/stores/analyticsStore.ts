import { ref } from "vue";
import { defineStore } from "pinia";
import type { AppSettings } from "../types/studio";
import {
  configureTracker,
  setFlushedListener,
  setTrackerContext,
} from "../features/analytics/useAnalyticsTracker";
import {
  createAnalyticsEventServices,
  type AnalyticsEventServices,
} from "../services/analyticsEvents";
import { createAnalyticsExportArchive } from "../services/analyticsExport";
import { resolveStorage } from "../services/storage/resolveStorage";
import { createObjectUrl, revokeObjectUrl } from "../shared/objectUrls";
import { createId } from "../shared/id";

const SESSION_ID_KEY = "gpt-image-studio:analytics-session-id";

function getOrCreateSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = createId("sess");
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return createId("sess");
  }
}

type AnalyticsStoreServices = {
  /** 阶段一 PR2：analyticsEvents service 通过 configure 注入（决策 T1）。
   *  analyticsExport 暂留模块级 import（它是导出编排逻辑，非纯存储层）。 */
  analyticsEvents: AnalyticsEventServices;
};

// 模块级默认 service 实例，供未显式注入时使用（PR4 后 ViewModel 统一注入）。
const defaultServices: AnalyticsStoreServices = {
  analyticsEvents: createAnalyticsEventServices(resolveStorage()),
};

export const useAnalyticsStore = defineStore("analytics", () => {
  const eventCount = ref(0);
  const sessionId = getOrCreateSessionId();
  let services: AnalyticsStoreServices = defaultServices;

  // flush 成功落库后同步递增计数，让面板能实时反映新增事件。
  setFlushedListener((count) => {
    eventCount.value += count;
  });

  function configure(
    settings: Pick<
      AppSettings,
      "analyticsEnabled" | "analyticsPromptCapture"
    >,
    injectedServices?: AnalyticsStoreServices,
  ) {
    if (injectedServices) {
      services = injectedServices;
    }
    configureTracker({
      enabled: settings.analyticsEnabled,
      promptCapture: settings.analyticsPromptCapture,
      sessionId,
    });
  }

  function setContext(context: {
    conversationId?: string;
    messageId?: string;
    imageId?: string;
  }) {
    setTrackerContext(context);
  }

  function requireServices(): AnalyticsStoreServices {
    if (!services) {
      throw new Error("Analytics store services are not configured.");
    }
    return services;
  }

  async function refreshEventCount() {
    try {
      const events = await requireServices().analyticsEvents.list();
      eventCount.value = events.length;
    } catch {
      eventCount.value = 0;
    }
  }

  async function exportEvents() {
    const blob = await createAnalyticsExportArchive();
    const url = createObjectUrl(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `analytics-export-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    anchor.click();
    revokeObjectUrl(url);
  }

  async function clearEvents() {
    await requireServices().analyticsEvents.clear();
    eventCount.value = 0;
  }

  return {
    eventCount,
    configure,
    setContext,
    refreshEventCount,
    exportEvents,
    clearEvents,
  };
});
