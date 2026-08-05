import { describe, expect, it } from "vitest";
import {
  continuedGenerationLabel,
  filenameFromAsset,
  outputFormatToMimeType,
  pendingGenerationLabel,
  pendingResultLabel,
  resultCountLabel,
  titleFromPrompt,
} from "./generationLabels";
import type { ImageAsset } from "../types/studio";

describe("titleFromPrompt", () => {
  it("returns prompt as-is when <= 16 chars", () => {
    expect(titleFromPrompt("short")).toBe("short");
    expect(titleFromPrompt("0123456789012345")).toBe("0123456789012345");
  });

  it("truncates to 16 chars + ellipsis when longer", () => {
    expect(titleFromPrompt("01234567890123456")).toBe("0123456789012345...");
    expect(titleFromPrompt("a very long prompt that exceeds the limit")).toBe(
      "a very long prom...",
    );
  });
});

describe("filenameFromAsset", () => {
  it("uses asset.name + jpeg extension for jpeg mime", () => {
    const asset = { name: "art", mimeType: "image/jpeg", id: "x" } as ImageAsset;
    expect(filenameFromAsset(asset)).toBe("art.jpeg");
  });

  it("uses asset.name + webp extension for webp mime", () => {
    const asset = { name: "art", mimeType: "image/webp", id: "x" } as ImageAsset;
    expect(filenameFromAsset(asset)).toBe("art.webp");
  });

  it("falls back to png extension for png / unknown mime", () => {
    expect(filenameFromAsset({ name: "a", mimeType: "image/png", id: "x" } as ImageAsset)).toBe("a.png");
    expect(filenameFromAsset({ name: "a", mimeType: "image/gif", id: "x" } as ImageAsset)).toBe("a.png");
  });

  it("falls back to asset.id when name is empty", () => {
    const asset = { name: "", mimeType: "image/png", id: "abc-123" } as ImageAsset;
    expect(filenameFromAsset(asset)).toBe("abc-123.png");
  });
});

describe("outputFormatToMimeType", () => {
  it("maps jpeg to image/jpeg (special case)", () => {
    expect(outputFormatToMimeType("jpeg")).toBe("image/jpeg");
  });

  it("maps other formats via image/<format>", () => {
    expect(outputFormatToMimeType("png")).toBe("image/png");
    expect(outputFormatToMimeType("webp")).toBe("image/webp");
  });
});

describe("resultCountLabel", () => {
  it("uses singular form for count === 1", () => {
    expect(resultCountLabel("已生成", 1)).toBe("已生成一张图片。");
  });

  it("uses plural form for count > 1", () => {
    expect(resultCountLabel("已生成", 3)).toBe("已生成 3 张图片。");
  });
});

describe("pendingGenerationLabel", () => {
  it("generates text-only label for count === 1", () => {
    expect(pendingGenerationLabel(false, 1)).toBe("正在生成图片。");
  });

  it("generates plural text-only label", () => {
    expect(pendingGenerationLabel(false, 2)).toBe("正在生成 2 张图片。");
  });

  it("generates edit label for count === 1", () => {
    expect(pendingGenerationLabel(true, 1)).toBe("正在基于引用图片生成编辑结果。");
  });

  it("generates plural edit label", () => {
    expect(pendingGenerationLabel(true, 3)).toBe("正在基于引用图片生成 3 张编辑结果。");
  });
});

describe("continuedGenerationLabel", () => {
  it("handles text + replace case", () => {
    expect(continuedGenerationLabel(false, true, 1)).toBe("正在重新生成图片。");
  });

  it("handles text + continue + multiple", () => {
    expect(continuedGenerationLabel(false, false, 2)).toBe("正在继续生成 2 张图片。");
  });

  it("handles edit + replace case", () => {
    expect(continuedGenerationLabel(true, true, 1)).toBe("正在重新生成编辑结果。");
  });

  it("handles edit + continue + single", () => {
    expect(continuedGenerationLabel(true, false, 1)).toBe("正在继续生成编辑结果。");
  });
});

describe("pendingResultLabel", () => {
  it("omits generated part when generatedCount is 0", () => {
    expect(pendingResultLabel(false, 0, 2)).toBe("还有 2 张图片正在生成。");
  });

  it("includes generated part when generatedCount > 0", () => {
    expect(pendingResultLabel(false, 1, 2)).toBe("已生成 1 张，还有 2 张图片正在生成。");
  });

  it("uses edit noun for isEdit", () => {
    expect(pendingResultLabel(true, 0, 1)).toBe("还有 1 张编辑结果正在生成。");
  });
});
