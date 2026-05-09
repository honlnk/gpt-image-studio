import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  isoTimestamp,
} from "./dateTime";

describe("date time helpers", () => {
  const base = Date.parse("2026-05-08T10:00:00.000Z");

  it("stores real timestamps as ISO strings", () => {
    expect(isoTimestamp(base)).toBe("2026-05-08T10:00:00.000Z");
  });

  it("formats recent timestamps as relative labels", () => {
    expect(formatRelativeTime("2026-05-08T09:59:45.000Z", base)).toBe("刚刚");
    expect(formatRelativeTime("2026-05-08T09:59:20.000Z", base)).toBe("一分钟内");
    expect(formatRelativeTime("2026-05-08T09:54:00.000Z", base)).toBe("6 分钟前");
    expect(formatRelativeTime("2026-05-08T08:00:00.000Z", base)).toBe("2 小时前");
  });

  it("does not fall back to invalid display labels", () => {
    expect(formatRelativeTime("刚刚", base)).toBe("未知时间");
  });
});
