import { describe, expect, it } from "vitest";
import {
  alignToStep,
  alignToStepAtLeastMin,
  clampToStep,
  clampToStepAtLeastMin,
  dimensionsFromRatio,
  parseSizeInput,
  shrinkLongestSideByStep,
  toDashScopeSize,
} from "../sizeUtils.js";
import type { SizeConstraints } from "../types.js";

const CONSTRAINTS: SizeConstraints = {
  step: 32,
  min: 256,
  max: 2048,
  maxPixels: 4194304,
  minPixels: 655360,
  maxAspectRatio: 3,
  defaultSize: "1024x1024",
};

describe("parseSizeInput", () => {
  it("returns auto=true for 'auto' / '' ", () => {
    expect(parseSizeInput("auto", CONSTRAINTS).auto).toBe(true);
    expect(parseSizeInput("", CONSTRAINTS).auto).toBe(true);
    expect(parseSizeInput("  auto  ", CONSTRAINTS).auto).toBe(true);
  });

  it("parses WxH and W×H by default", () => {
    const parsed = parseSizeInput("1024x768", CONSTRAINTS);
    expect(parsed.auto).toBe(false);
    if (!parsed.auto && parsed.width !== undefined) {
      expect(parsed.width).toBe(1024);
      expect(parsed.height).toBe(768);
    }
  });

  it("parses W×H (Unicode multiplication sign)", () => {
    const parsed = parseSizeInput("1024×768", CONSTRAINTS);
    expect(parsed.auto).toBe(false);
  });

  it("rejects W*H by default, accepts with allowStarSeparator", () => {
    expect(parseSizeInput("1024*768", CONSTRAINTS).auto).toBe(false);
    // W*H 不匹配 [x×]，会被判为无法识别
    const withoutStar = parseSizeInput("1024*768", CONSTRAINTS);
    expect(withoutStar.auto).toBe(false);
    if (!withoutStar.auto) {
      expect(withoutStar.width).toBeUndefined();
    }
    const withStar = parseSizeInput("1024*768", CONSTRAINTS, {
      allowStarSeparator: true,
    });
    if (!withStar.auto) {
      expect(withStar.width).toBe(1024);
    }
  });

  it("parses ratio (W:H) using maxPixels base strategy by default", () => {
    const parsed = parseSizeInput("16:9", CONSTRAINTS);
    expect(parsed.auto).toBe(false);
    if (!parsed.auto && parsed.width !== undefined && parsed.height !== undefined) {
      // 16:9 under maxPixels=4194304 → sqrt(4194304 * 16/9) ≈ 2731
      expect(parsed.width).toBeGreaterThan(parsed.height);
    }
  });

  it("returns unrecognized for invalid input", () => {
    const parsed = parseSizeInput("abc", CONSTRAINTS);
    expect(parsed.auto).toBe(false);
    if (!parsed.auto) {
      expect(parsed.width).toBeUndefined();
    }
  });
});

describe("dimensionsFromRatio", () => {
  it("returns width > height for landscape ratio (maxPixels strategy)", () => {
    const { width, height } = dimensionsFromRatio("16:9", CONSTRAINTS);
    expect(width).toBeGreaterThan(height);
  });

  it("returns height > width for portrait ratio", () => {
    const { width, height } = dimensionsFromRatio("9:16", CONSTRAINTS);
    expect(height).toBeGreaterThan(width);
  });

  it("returns roughly equal for 1:1", () => {
    const { width, height } = dimensionsFromRatio("1:1", CONSTRAINTS);
    expect(Math.abs(width - height)).toBeLessThanOrEqual(1);
  });

  it("returns 0,0 for invalid ratio", () => {
    const { width, height } = dimensionsFromRatio("0:0", CONSTRAINTS);
    expect(width).toBe(0);
    expect(height).toBe(0);
  });

  it("geoMean strategy uses sqrt(minPixels * maxPixels) as base", () => {
    const result = dimensionsFromRatio("1:1", CONSTRAINTS, "geoMean");
    // sqrt(minPixels * maxPixels) = sqrt(655360 * 4194304) ≈ 1656790 → sqrt ≈ 1287
    expect(result.width).toBeGreaterThan(1000);
    expect(result.width).toBeLessThan(1500);
  });

  it("minOfMaxAndSqrtMaxPixels strategy uses min(max, sqrt(maxPixels))", () => {
    // sqrt(4194304) = 2048, min(2048, 2048) = 2048
    const result = dimensionsFromRatio("1:1", CONSTRAINTS, "minOfMaxAndSqrtMaxPixels");
    expect(result.width).toBe(2048);
  });
});

describe("alignToStep", () => {
  it("rounds to nearest step multiple (banker's rounding via Math.round)", () => {
    expect(alignToStep(1000, CONSTRAINTS)).toBe(992); // 1000/32=31.25 → round(31.25)=31 → 31*32=992
    expect(alignToStep(1024, CONSTRAINTS)).toBe(1024); // 已对齐
    expect(alignToStep(1025, CONSTRAINTS)).toBe(1024); // 1025/32=32.03 → round=32 → 1024
    expect(alignToStep(1040, CONSTRAINTS)).toBe(1056); // 1040/32=32.5 → round(32.5)=33 → 33*32=1056
    expect(alignToStep(1056, CONSTRAINTS)).toBe(1056); // 已对齐
  });
});

describe("alignToStepAtLeastMin", () => {
  it("rounds to nearest step multiple but never below step", () => {
    expect(alignToStepAtLeastMin(0, CONSTRAINTS)).toBe(32);
    expect(alignToStepAtLeastMin(1, CONSTRAINTS)).toBe(32);
    expect(alignToStepAtLeastMin(1024, CONSTRAINTS)).toBe(1024);
  });
});

describe("clampToStep", () => {
  it("clamps to [min, max] then aligns to step", () => {
    // 100 → 钳制到 min=256 → alignToStep(256)=256
    expect(clampToStep(100, 256, 2048, CONSTRAINTS)).toBe(256);
    // 9999 → 钳制到 max=2048
    expect(clampToStep(9999, 256, 2048, CONSTRAINTS)).toBe(2048);
    // 范围内：alignToStep(1000)=992
    expect(clampToStep(1000, 256, 2048, CONSTRAINTS)).toBe(992);
  });
});

describe("clampToStepAtLeastMin", () => {
  it("clamps to [min, max] then aligns with at-least-step floor", () => {
    expect(clampToStepAtLeastMin(0, 256, 2048, CONSTRAINTS)).toBe(256);
    expect(clampToStepAtLeastMin(9999, 256, 2048, CONSTRAINTS)).toBe(2048);
  });
});

describe("shrinkLongestSideByStep", () => {
  it("shrinks width when width >= height", () => {
    const result = shrinkLongestSideByStep(1024, 512, CONSTRAINTS);
    expect(result.width).toBe(1024 - 32);
    expect(result.height).toBe(512);
  });

  it("shrinks height when height > width", () => {
    const result = shrinkLongestSideByStep(512, 1024, CONSTRAINTS);
    expect(result.width).toBe(512);
    expect(result.height).toBe(1024 - 32);
  });

  it("uses provided align function when given", () => {
    const result = shrinkLongestSideByStep(1024, 512, CONSTRAINTS, alignToStepAtLeastMin);
    // alignToStepAtLeastMin(1024-32=992) = 992
    expect(result.width).toBe(992);
  });
});

describe("toDashScopeSize", () => {
  it("replaces x with *", () => {
    expect(toDashScopeSize("1024x768")).toBe("1024*768");
  });

  it("replaces × (Unicode) with *", () => {
    expect(toDashScopeSize("1024×768")).toBe("1024*768");
  });

  it("leaves already-dashscope format unchanged", () => {
    expect(toDashScopeSize("1024*768")).toBe("1024*768");
  });
});
