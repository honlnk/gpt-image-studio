import { describe, expect, it } from "vitest";
import type { ImageAsset } from "../../types/studio";
import {
  classifyImageSource,
  imageFormat,
  sourceLabel,
} from "./imageLibraryFormatters";

function baseImage(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "img-1",
    name: "测试图片",
    source: "generated",
    prompt: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("classifyImageSource", () => {
  it("导入图判为 imported", () => {
    expect(classifyImageSource(baseImage({ source: "imported" }))).toBe(
      "imported",
    );
  });

  it("纯文生图（无编辑/引用字段）判为 generated", () => {
    expect(classifyImageSource(baseImage({ source: "generated" }))).toBe(
      "generated",
    );
  });

  it("带 editSourceImageId 判为 edited", () => {
    expect(
      classifyImageSource(
        baseImage({ source: "generated", editSourceImageId: "img-base" }),
      ),
    ).toBe("edited");
  });

  it("带 referencedImageIds 判为 edited", () => {
    expect(
      classifyImageSource(
        baseImage({
          source: "generated",
          referencedImageIds: ["ref-1", "ref-2"],
        }),
      ),
    ).toBe("edited");
  });

  it("带空 referencedImageIds 仍判为 generated", () => {
    expect(
      classifyImageSource(
        baseImage({ source: "generated", referencedImageIds: [] }),
      ),
    ).toBe("generated");
  });

  it("同时带 editSourceImageId 与 referencedImageIds 判为 edited", () => {
    expect(
      classifyImageSource(
        baseImage({
          source: "generated",
          editSourceImageId: "img-base",
          referencedImageIds: ["ref-1"],
        }),
      ),
    ).toBe("edited");
  });

  it("导入图即便带 editSourceImageId 也判为 imported（source 优先）", () => {
    expect(
      classifyImageSource(
        baseImage({
          source: "imported",
          editSourceImageId: "img-base",
        }),
      ),
    ).toBe("imported");
  });
});

describe("sourceLabel", () => {
  it("纯生成图显示「生成图」", () => {
    expect(sourceLabel(baseImage({ source: "generated" }))).toBe("生成图");
  });

  it("编辑图显示「编辑图」", () => {
    expect(
      sourceLabel(
        baseImage({ source: "generated", editSourceImageId: "img-base" }),
      ),
    ).toBe("编辑图");
  });

  it("导入图显示「导入图」", () => {
    expect(sourceLabel(baseImage({ source: "imported" }))).toBe("导入图");
  });
});

describe("imageFormat", () => {
  it("剥除 image/ 前缀并大写", () => {
    expect(imageFormat(baseImage({ mimeType: "image/png" }))).toBe("PNG");
    expect(imageFormat(baseImage({ mimeType: "image/webp" }))).toBe("WEBP");
  });

  it("无 mimeType 显示「未知」", () => {
    expect(imageFormat(baseImage({ mimeType: undefined }))).toBe("未知");
  });
});
