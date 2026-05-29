import { describe, expect, it } from "vitest";
import { normalizeGenerationParams } from "./generationParams";

describe("generation params normalization", () => {
  it("maps legacy fixed sizes to ratio presets", () => {
    expect(
      normalizeGenerationParams({
        size: "1536x1024",
        width: 1536,
        height: 1024,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      }),
    ).toEqual({
      size: "3:2",
      resolution: "2k",
      width: 1536,
      height: 1024,
      imageCount: 1,
      quality: "auto",
      background: "auto",
      outputFormat: "png",
    });
  });

  it("normalizes image count without an upper limit", () => {
    expect(
      normalizeGenerationParams({
        size: "auto",
        width: 1024,
        height: 1024,
        imageCount: 9,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      }).imageCount,
    ).toBe(9);

    expect(
      normalizeGenerationParams({
        size: "auto",
        width: 1024,
        height: 1024,
        imageCount: 0,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      }).imageCount,
    ).toBe(1);
  });
});
