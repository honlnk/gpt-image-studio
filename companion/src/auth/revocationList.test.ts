import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  revokeUser,
  revokeJti,
  isUserRevoked,
  isJtiRevoked,
  clear,
  size,
  startCleanupTimer,
  stopCleanupTimer,
} from "./revocationList.js";

describe("revocationList", () => {
  beforeEach(() => {
    clear();
  });

  describe("revokeUser / isUserRevoked", () => {
    it("吊销后用户被标记为 revoked", () => {
      revokeUser("user-1");
      expect(isUserRevoked("user-1")).toBe(true);
    });

    it("未吊销的用户返回 false", () => {
      expect(isUserRevoked("user-2")).toBe(false);
    });

    it("不同用户互不影响", () => {
      revokeUser("user-1");
      expect(isUserRevoked("user-1")).toBe(true);
      expect(isUserRevoked("user-2")).toBe(false);
    });
  });

  describe("revokeJti / isJtiRevoked", () => {
    it("吊销单个 jti", () => {
      revokeJti("jti-abc");
      expect(isJtiRevoked("jti-abc")).toBe(true);
    });

    it("jti 吊销不影响其他 jti", () => {
      revokeJti("jti-1");
      expect(isJtiRevoked("jti-1")).toBe(true);
      expect(isJtiRevoked("jti-2")).toBe(false);
    });
  });

  describe("user 与 jti 独立", () => {
    it("吊销 user 不影响 jti 检查", () => {
      revokeUser("user-1");
      expect(isUserRevoked("user-1")).toBe(true);
      expect(isJtiRevoked("user-1")).toBe(false);
    });

    it("吊销 jti 不影响 user 检查", () => {
      revokeJti("some-jti");
      expect(isJtiRevoked("some-jti")).toBe(true);
      expect(isUserRevoked("some-jti")).toBe(false);
    });
  });

  describe("TTL 过期", () => {
    it("TTL 过期后用户恢复访问", () => {
      // 用 vi 模拟时间
      vi.useFakeTimers();
      const now = new Date("2026-07-27T12:00:00Z");
      vi.setSystemTime(now);

      revokeUser("user-1", 60); // 60 秒 TTL
      expect(isUserRevoked("user-1")).toBe(true);

      // 前进 59 秒——仍在 TTL 内
      vi.setSystemTime(new Date("2026-07-27T12:00:59Z"));
      expect(isUserRevoked("user-1")).toBe(true);

      // 前进到 61 秒——TTL 过期
      vi.setSystemTime(new Date("2026-07-27T12:01:01Z"));
      expect(isUserRevoked("user-1")).toBe(false);

      vi.useRealTimers();
    });

    it("jti TTL 过期后恢复", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));

      revokeJti("jti-1", 30);
      expect(isJtiRevoked("jti-1")).toBe(true);

      vi.setSystemTime(new Date("2026-07-27T12:00:31Z"));
      expect(isJtiRevoked("jti-1")).toBe(false);

      vi.useRealTimers();
    });

    it("默认 TTL（不传 ttlSeconds）", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));

      revokeUser("user-1"); // 默认 3600 秒
      expect(isUserRevoked("user-1")).toBe(true);

      // 3599 秒还在
      vi.setSystemTime(new Date("2026-07-27T12:59:59Z"));
      expect(isUserRevoked("user-1")).toBe(true);

      // 3601 秒过期
      vi.setSystemTime(new Date("2026-07-27T13:00:01Z"));
      expect(isUserRevoked("user-1")).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("clear / size", () => {
    it("clear 清空黑名单", () => {
      revokeUser("user-1");
      revokeJti("jti-1");
      expect(size()).toBe(2);
      clear();
      expect(size()).toBe(0);
      expect(isUserRevoked("user-1")).toBe(false);
    });
  });

  describe("清理定时器", () => {
    it("startCleanupTimer 是幂等的（重复调用不报错）", () => {
      startCleanupTimer();
      startCleanupTimer();
      stopCleanupTimer();
    });

    it("stopCleanupTimer 后可重新 start", () => {
      startCleanupTimer();
      stopCleanupTimer();
      startCleanupTimer();
      stopCleanupTimer();
    });
  });
});
