import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import {
  formatRelativeTime,
  isoTimestamp,
} from "./dateTime";

// 测试环境 i18n 解析为 en-US，相对时间标签由 Intl.RelativeTimeFormat(en-US) 产出。
describe("date time helpers", () => {
  const base = Date.parse("2026-05-08T10:00:00.000Z");

  it("stores real timestamps as ISO strings", () => {
    expect(isoTimestamp(base)).toBe("2026-05-08T10:00:00.000Z");
  });

  it("formats recent timestamps as relative labels", () => {
    expect(formatRelativeTime("2026-05-08T09:59:45.000Z", base)).toBe("now");
    expect(formatRelativeTime("2026-05-08T09:59:20.000Z", base)).toBe(
      "1 minute ago",
    );
    expect(formatRelativeTime("2026-05-08T09:54:00.000Z", base)).toBe(
      "6 minutes ago",
    );
    expect(formatRelativeTime("2026-05-08T08:00:00.000Z", base)).toBe(
      "2 hours ago",
    );
  });

  it("does not fall back to invalid display labels", () => {
    expect(formatRelativeTime("刚刚", base)).toBe(t("common.time.unknown"));
  });
});
