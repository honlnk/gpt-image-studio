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
      quality: "auto",
      background: "auto",
      outputFormat: "png",
    });
  });
});
