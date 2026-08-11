import { describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "../types/studio";
import {
  computeEventDistribution,
  computeGenerationFunnel,
  computeInsights,
  computeOverview,
  computePromptModeComparison,
  computeSatisfactionProxy,
  computeTimeSeries,
} from "./analyticsAnalysis";

let seq = 0;
function makeEvent(
  overrides: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "eventName">,
): AnalyticsEvent {
  seq += 1;
  return {
    id: `ev-${seq}`,
    occurredAt: `2026-08-0${((seq - 1) % 7) + 1}T10:00:00.000Z`,
    sessionId: "sess-1",
    source: "system",
    ...overrides,
  };
}

describe("computeOverview", () => {
  it("空事件返回零值", () => {
    const o = computeOverview([]);
    expect(o.totalEvents).toBe(0);
    expect(o.sessionCount).toBe(0);
    expect(o.conversationCount).toBe(0);
    expect(o.imageCount).toBe(0);
    expect(o.startAt).toBeNull();
    expect(o.endAt).toBeNull();
  });

  it("统计去重的会话/会话/图片数与时间范围", () => {
    const o = computeOverview([
      makeEvent({
        eventName: "generation.succeeded",
        sessionId: "s1",
        conversationId: "c1",
        imageId: "img1",
        occurredAt: "2026-08-01T10:00:00.000Z",
      }),
      makeEvent({
        eventName: "generation.succeeded",
        sessionId: "s2",
        conversationId: "c1",
        imageId: "img2",
        occurredAt: "2026-08-05T10:00:00.000Z",
      }),
    ]);
    expect(o.totalEvents).toBe(2);
    expect(o.sessionCount).toBe(2);
    expect(o.conversationCount).toBe(1);
    expect(o.imageCount).toBe(2);
    expect(o.startAt).toBe("2026-08-01T10:00:00.000Z");
    expect(o.endAt).toBe("2026-08-05T10:00:00.000Z");
  });
});

describe("computeGenerationFunnel", () => {
  it("requested=0 时 successRate=0", () => {
    const f = computeGenerationFunnel([]);
    expect(f).toEqual({ requested: 0, succeeded: 0, failed: 0, successRate: 0 });
  });

  it("正确计数并计算成功率", () => {
    const f = computeGenerationFunnel([
      makeEvent({ eventName: "generation.requested" }),
      makeEvent({ eventName: "generation.requested" }),
      makeEvent({ eventName: "generation.requested" }),
      makeEvent({ eventName: "generation.succeeded" }),
      makeEvent({ eventName: "generation.succeeded" }),
      makeEvent({ eventName: "generation.failed" }),
      makeEvent({ eventName: "image.downloaded" }), // 无关事件不计入漏斗
    ]);
    expect(f.requested).toBe(3);
    expect(f.succeeded).toBe(2);
    expect(f.failed).toBe(1);
    expect(f.successRate).toBeCloseTo(2 / 3);
  });
});

describe("computeSatisfactionProxy", () => {
  it("无生成成功事件时全零", () => {
    const s = computeSatisfactionProxy([
      makeEvent({ eventName: "image.downloaded", imageId: "img1" }),
    ]);
    expect(s.generated).toBe(0);
    expect(s.keptRate).toBe(0);
  });

  it("只计生成图片集合内的下载/打标/删除，排除导入图", () => {
    const s = computeSatisfactionProxy([
      makeEvent({ eventName: "generation.succeeded", imageId: "g1" }),
      makeEvent({ eventName: "generation.succeeded", imageId: "g2" }),
      makeEvent({ eventName: "generation.succeeded", imageId: "g3" }),
      makeEvent({ eventName: "image.downloaded", imageId: "g1" }),
      makeEvent({ eventName: "image.tag_color_set", imageId: "g2" }),
      makeEvent({ eventName: "image.deleted", imageId: "g3" }),
      // 导入图的下载不应计入生成满意度
      makeEvent({ eventName: "image.downloaded", imageId: "imported1" }),
    ]);
    expect(s.generated).toBe(3);
    expect(s.downloaded).toBe(1);
    expect(s.tagged).toBe(1);
    expect(s.deleted).toBe(1);
    expect(s.downloadRate).toBeCloseTo(1 / 3);
    expect(s.tagRate).toBeCloseTo(1 / 3);
    expect(s.keptRate).toBeCloseTo(2 / 3);
  });

  it("同一图片下载多次只计一次", () => {
    const s = computeSatisfactionProxy([
      makeEvent({ eventName: "generation.succeeded", imageId: "g1" }),
      makeEvent({ eventName: "image.downloaded", imageId: "g1" }),
      makeEvent({ eventName: "image.downloaded", imageId: "g1" }),
    ]);
    expect(s.downloaded).toBe(1);
    expect(s.downloadRate).toBe(1);
  });
});

describe("computePromptModeComparison", () => {
  it("按 promptMode 分组并计算成功率/满意度", () => {
    const events: AnalyticsEvent[] = [
      // msg1: creative，请求1 成功1，下载1（满意）
      makeEvent({
        eventName: "generation.requested",
        messageId: "msg1",
        payload: { promptMode: "creative" },
      }),
      makeEvent({
        eventName: "generation.succeeded",
        messageId: "msg1",
        imageId: "img1",
      }),
      makeEvent({ eventName: "image.downloaded", imageId: "img1" }),
      // msg2: default，请求2 成功1 失败1
      makeEvent({
        eventName: "generation.requested",
        messageId: "msg2",
        payload: { promptMode: "default" },
      }),
      makeEvent({
        eventName: "generation.requested",
        messageId: "msg2b",
        payload: { promptMode: "default" },
      }),
      makeEvent({
        eventName: "generation.succeeded",
        messageId: "msg2",
        imageId: "img2",
      }),
      makeEvent({
        eventName: "generation.failed",
        messageId: "msg2b",
      }),
    ];
    const rows = computePromptModeComparison(events);
    const creative = rows.find((r) => r.promptMode === "creative");
    const def = rows.find((r) => r.promptMode === "default");
    expect(creative?.requested).toBe(1);
    expect(creative?.succeeded).toBe(1);
    expect(creative?.successRate).toBe(1);
    expect(creative?.satisfactionRate).toBe(1);
    expect(def?.requested).toBe(2);
    expect(def?.succeeded).toBe(1);
    expect(def?.successRate).toBe(0.5);
    expect(def?.satisfactionRate).toBe(0); // img2 未下载/打标
  });

  it("无 promptMode 的 requested 归入 unknown", () => {
    const rows = computePromptModeComparison([
      makeEvent({ eventName: "generation.requested", messageId: "m1" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.promptMode).toBe("unknown");
  });

  it("成功事件通过 messageId 反查模式", () => {
    const rows = computePromptModeComparison([
      makeEvent({
        eventName: "generation.requested",
        messageId: "m1",
        payload: { promptMode: "safe" },
      }),
      makeEvent({
        eventName: "generation.succeeded",
        messageId: "m1",
        imageId: "img1",
      }),
    ]);
    expect(rows[0]?.promptMode).toBe("safe");
    expect(rows[0]?.succeeded).toBe(1);
  });
});

describe("computeEventDistribution", () => {
  it("按计数降序排列，相同计数按名称", () => {
    const rows = computeEventDistribution([
      makeEvent({ eventName: "a" }),
      makeEvent({ eventName: "b" }),
      makeEvent({ eventName: "b" }),
      makeEvent({ eventName: "a" }),
    ]);
    expect(rows.map((r) => r.eventName)).toEqual(["a", "b"]);
    expect(rows[0]?.count).toBe(2);
    expect(rows[1]?.count).toBe(2);
  });
});

describe("computeTimeSeries", () => {
  it("空事件或 days<=0 返回空数组", () => {
    expect(computeTimeSeries([], 14)).toEqual([]);
    expect(
      computeTimeSeries([makeEvent({ eventName: "generation.requested" })], 0),
    ).toEqual([]);
  });

  it("最近 N 天补零，窗口外不计", () => {
    // 用固定 today 避免测试跨日抖动
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLabel = dateLabelOf(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLabel = dateLabelOf(yesterday);
    const farPast = new Date(today);
    farPast.setDate(farPast.getDate() - 100);
    const events: AnalyticsEvent[] = [
      {
        id: "e1",
        eventName: "generation.requested",
        occurredAt: new Date(today.getTime() + 3600_000).toISOString(),
        sessionId: "s1",
        source: "system",
      },
      {
        id: "e2",
        eventName: "generation.succeeded",
        occurredAt: new Date(yesterday.getTime() + 7200_000).toISOString(),
        sessionId: "s1",
        source: "system",
      },
      {
        id: "e3",
        eventName: "generation.requested",
        occurredAt: farPast.toISOString(),
        sessionId: "s1",
        source: "system",
      },
    ];
    const series = computeTimeSeries(events, 7);
    expect(series).toHaveLength(7);
    const todayBucket = series.find((b) => b.date === todayLabel);
    const yesterdayBucket = series.find((b) => b.date === yesterdayLabel);
    expect(todayBucket?.requested).toBe(1);
    expect(yesterdayBucket?.succeeded).toBe(1);
    // 远古事件不在窗口内
    const totalRequested = series.reduce((sum, b) => sum + b.requested, 0);
    expect(totalRequested).toBe(1);
  });
});

describe("computeInsights", () => {
  it("聚合全部子指标", () => {
    const insights = computeInsights([
      makeEvent({ eventName: "generation.requested", messageId: "m1", payload: { promptMode: "default" } }),
      makeEvent({ eventName: "generation.succeeded", messageId: "m1", imageId: "img1" }),
    ]);
    expect(insights.overview.totalEvents).toBe(2);
    expect(insights.funnel.successRate).toBe(1);
    expect(insights.satisfaction.generated).toBe(1);
    expect(insights.promptModes).toHaveLength(1);
    expect(insights.topEvents.length).toBeGreaterThan(0);
    // timeSeries 在事件落入窗口时非空
    expect(insights.timeSeries.length).toBeGreaterThan(0);
  });
});

function dateLabelOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
