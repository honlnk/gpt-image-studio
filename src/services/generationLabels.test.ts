import { describe, expect, it } from "vitest";
import { t } from "../i18n";
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
    expect(resultCountLabel("已生成", 1)).toBe(
      t("generation.result.countSingular", { prefix: "已生成" }),
    );
  });

  it("uses plural form for count > 1", () => {
    expect(resultCountLabel("已生成", 3)).toBe(
      t("generation.result.countPlural", { prefix: "已生成", count: 3 }),
    );
  });
});

describe("pendingGenerationLabel", () => {
  it("generates text-only label for count === 1", () => {
    expect(pendingGenerationLabel(false, 1)).toBe(t("generation.pending.textSingular"));
  });

  it("generates plural text-only label", () => {
    expect(pendingGenerationLabel(false, 2)).toBe(
      t("generation.pending.textPlural", { count: 2 }),
    );
  });

  it("generates edit label for count === 1", () => {
    expect(pendingGenerationLabel(true, 1)).toBe(t("generation.pending.editSingular"));
  });

  it("generates plural edit label", () => {
    expect(pendingGenerationLabel(true, 3)).toBe(
      t("generation.pending.editPlural", { count: 3 }),
    );
  });
});

describe("continuedGenerationLabel", () => {
  it("handles text + replace case", () => {
    expect(continuedGenerationLabel(false, true, 1)).toBe(t("generation.regenerating.image"));
  });

  it("handles text + continue + multiple", () => {
    expect(continuedGenerationLabel(false, false, 2)).toBe(
      t("generation.continued.textPlural", { count: 2 }),
    );
  });

  it("handles edit + replace case", () => {
    expect(continuedGenerationLabel(true, true, 1)).toBe(
      t("generation.regenerating.editResult"),
    );
  });

  it("handles edit + continue + single", () => {
    expect(continuedGenerationLabel(true, false, 1)).toBe(
      t("generation.continued.editSingular"),
    );
  });
});

describe("pendingResultLabel", () => {
  it("omits generated part when generatedCount is 0", () => {
    expect(pendingResultLabel(false, 0, 2)).toBe(
      t("generation.pendingResult.remaining", {
        count: 2,
        noun: t("generation.pendingResult.nounImage", 2),
      }),
    );
  });

  it("includes generated part when generatedCount > 0", () => {
    expect(pendingResultLabel(false, 1, 2)).toBe(
      t("generation.pendingResult.generatedPart", { count: 1 }) +
        t("generation.pendingResult.remaining", {
          count: 2,
          noun: t("generation.pendingResult.nounImage", 2),
        }),
    );
  });

  it("uses edit noun for isEdit", () => {
    expect(pendingResultLabel(true, 0, 1)).toBe(
      t("generation.pendingResult.remaining", {
        count: 1,
        noun: t("generation.pendingResult.nounEditResult", 1),
      }),
    );
  });
});
