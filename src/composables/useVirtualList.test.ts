/**
 * useVirtualList 纯函数 computeWindow 单元测试（server 模式分页 PR-e）。
 *
 * composable 本身的 DOM 监听（scroll/resize）无组件测试设施（无 @vue/test-utils），
 * 靠手动验证；窗口计算逻辑是核心，提取为纯函数在此覆盖。
 */
import { describe, expect, it } from "vitest";
import { computeWindow } from "./useVirtualList";

const ITEM_HEIGHT = 72;

describe("computeWindow", () => {
  it("空列表返回零区间", () => {
    expect(computeWindow(0, 600, 0, ITEM_HEIGHT, 4)).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetY: 0,
      totalHeight: 0,
    });
  });

  it("零视口高度返回零区间但 totalHeight 正确", () => {
    expect(computeWindow(0, 0, 100, ITEM_HEIGHT, 4)).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetY: 0,
      totalHeight: 100 * ITEM_HEIGHT,
    });
  });

  it("顶部：渲染前几条 + overscan 缓冲", () => {
    // 视口 600px，可见约 8-9 条（600/72≈8.3）。
    const w = computeWindow(0, 600, 100, ITEM_HEIGHT, 4);
    expect(w.startIndex).toBe(0); // 顶部不被负数
    expect(w.endIndex).toBe(9 + 4); // lastVisible(8)+1+overscan(4)=13
    expect(w.offsetY).toBe(0);
    expect(w.totalHeight).toBe(7200);
  });

  it("中间滚动：startIndex 受 overscan 缓冲且 offsetY 对齐", () => {
    // 滚到第 20 条顶部：scrollTop = 20*72 = 1440。
    const w = computeWindow(1440, 600, 100, ITEM_HEIGHT, 4);
    expect(w.startIndex).toBe(20 - 4); // 16
    // lastVisible = floor((1440+600)/72) = floor(28.33) = 28，endIndex = 28+1+4 = 33
    expect(w.endIndex).toBe(33);
    expect(w.offsetY).toBe(16 * ITEM_HEIGHT);
  });

  it("endIndex 不超过总条数", () => {
    // 滚到接近底部，endIndex 应被 count 截断。
    const w = computeWindow(6480, 600, 100, ITEM_HEIGHT, 4); // 90*72=6480
    expect(w.endIndex).toBeLessThanOrEqual(100);
    expect(w.startIndex).toBe(90 - 4);
  });

  it("overscan 不会让 startIndex 小于 0", () => {
    const w = computeWindow(72, 600, 100, ITEM_HEIGHT, 4); // 第 1 条
    expect(w.startIndex).toBe(0); // max(0, 1-4)
  });

  it("totalHeight 始终 = count * itemHeight", () => {
    for (const count of [1, 10, 500, 1000]) {
      const w = computeWindow(100, 600, count, ITEM_HEIGHT, 4);
      expect(w.totalHeight).toBe(count * ITEM_HEIGHT);
    }
  });

  it("刚好滚过最后一条：endIndex = count", () => {
    const count = 50;
    const scrollTop = (count - 1) * ITEM_HEIGHT; // 最后一条顶部
    const w = computeWindow(scrollTop, 200, count, ITEM_HEIGHT, 4);
    expect(w.endIndex).toBe(count);
  });
});
