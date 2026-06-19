import { ref } from "vue";
import { defineStore } from "pinia";
import type { AppSettings } from "../types/studio";
import {
  configureTracker,
  setFlushedListener,
  setTrackerContext,
} from "../features/analytics/useAnalyticsTracker";
import {
  clearAnalyticsEvents,
  listAnalyticsEvents,
} from "../services/analyticsEvents";
import { createAnalyticsExportArchive } from "../services/analyticsExport";
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

export const useAnalyticsStore = defineStore("analytics", () => {
  const eventCount = ref(0);
  const sessionId = getOrCreateSessionId();

  // flush 成功落库后同步递增计数，让面板能实时反映新增事件。
  setFlushedListener((count) => {
    eventCount.value += count;
  });

  function configure(settings: Pick<
    AppSettings,
    "analyticsEnabled" | "analyticsPromptCapture"
  >) {
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

  async function refreshEventCount() {
    try {
      const events = await listAnalyticsEvents();
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
    await clearAnalyticsEvents();
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
