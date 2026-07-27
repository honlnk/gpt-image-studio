import { describe, expect, it } from "vitest";
import { assertEditImageCount } from "../editGuards.js";

describe("assertEditImageCount", () => {
  it("throws when imageCount is 0", () => {
    expect(() => assertEditImageCount("Qwen-Image", 0, 5)).toThrow(
      "Qwen-Image 图像编辑需要至少一张参考图。",
    );
  });

  it("does not throw when imageCount is within maxImages", () => {
    expect(() => assertEditImageCount("Qwen-Image", 3, 5)).not.toThrow();
    expect(() => assertEditImageCount("Wan", 1, 1)).not.toThrow();
  });

  it("throws when imageCount exceeds maxImages", () => {
    expect(() => assertEditImageCount("Qwen-Image", 6, 5)).toThrow(
      "Qwen-Image 图像编辑最多支持 5 张参考图。",
    );
  });

  it("does not check upper bound when maxImages is undefined", () => {
    expect(() => assertEditImageCount("X", 100, undefined)).not.toThrow();
  });

  it("still throws for 0 images even when maxImages is undefined", () => {
    expect(() => assertEditImageCount("X", 0, undefined)).toThrow(
      "X 图像编辑需要至少一张参考图。",
    );
  });

  it("uses providerLabel verbatim in error messages", () => {
    expect(() => assertEditImageCount("Custom Provider", 0)).toThrow(
      "Custom Provider 图像编辑需要至少一张参考图。",
    );
  });
});
