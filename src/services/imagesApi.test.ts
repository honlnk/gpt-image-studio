import { describe, expect, it } from "vitest";
import { getCustomSizeError } from "./imagesApi";

describe("getCustomSizeError", () => {
  it("requires integer dimensions", () => {
    expect(getCustomSizeError(1024.5, 1024)).toBe("自定义尺寸的宽高必须是整数。");
    expect(getCustomSizeError(Number.NaN, 1024)).toBe("自定义尺寸的宽高必须是整数。");
  });

  it("requires dimensions between 16 and 3840 in 16px increments", () => {
    expect(getCustomSizeError(15, 1024)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
    expect(getCustomSizeError(3856, 1024)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
    expect(getCustomSizeError(1025, 1024)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
  });

  it("requires total pixels within the supported range", () => {
    expect(getCustomSizeError(256, 256)).toBe(
      "自定义尺寸的总像素必须在 655,360 到 8,294,400 之间。",
    );
    expect(getCustomSizeError(3840, 3840)).toBe(
      "自定义尺寸的总像素必须在 655,360 到 8,294,400 之间。",
    );
  });

  it("rejects dimensions with an aspect ratio greater than 3:1", () => {
    expect(getCustomSizeError(2048, 512)).toBe("自定义尺寸的长边与短边比例不能超过 3:1。");
  });

  it("allows valid dimensions", () => {
    expect(getCustomSizeError(1024, 1024)).toBe("");
    expect(getCustomSizeError(1536, 1024)).toBe("");
    expect(getCustomSizeError(1920, 1088)).toBe("");
  });
});
