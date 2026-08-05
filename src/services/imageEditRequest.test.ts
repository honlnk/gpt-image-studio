import { describe, expect, it, vi } from "vitest";
import { resolveImageEditRequest } from "./imageEditRequest";
import type { GenerationParams, ImageAsset, PromptRequestSettings } from "../types/studio";

const PARAMS: GenerationParams = {
  size: "custom",
  width: 1024,
  height: 1024,
  resolution: "1k",
  quality: "high",
  background: "auto",
  outputFormat: "png",
  imageCount: 1,
};

const PROMPT_REQUEST_SETTINGS: PromptRequestSettings = {
  promptMode: "default",
  promptWordbanks: {
    pose: { safe: [], creative: [], nsfw: [] },
    adultInspiration: [],
  },
  promptRewriteGuardEnabled: false,
  promptRewriteGuardText: "",
};

function makeImage(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "img-1",
    blobKey: "blob-1",
    name: "source",  // 不带扩展名：filenameFromAsset 会自动加 .png
    source: "generated",
    tagColor: "blue",
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    sizeBytes: 1024,
    conversationId: "c1",
    messageId: "m1",
    prompt: "a cat",
    generationDurationMs: 0,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

describe("resolveImageEditRequest", () => {
  it("resolves references into blob + name", async () => {
    const image = makeImage();
    const resolveBlob = vi.fn().mockResolvedValue(new Blob(["data"], { type: "image/png" }));
    const result = await resolveImageEditRequest({
      prompt: "edit this",
      references: ["img-1"],
      params: PARAMS,
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      imageById: () => image,
      resolveBlob,
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].name).toBe("source.png");
    expect(result.mask).toBeUndefined();
  });

  it("throws when reference image is not found", async () => {
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["missing"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        imageById: () => undefined,
        resolveBlob: async () => new Blob(),
      }),
    ).rejects.toThrow("引用图片不存在，请重新添加引用。");
  });

  it("throws when blob cannot be resolved", async () => {
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["img-1"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        imageById: () => makeImage(),
        resolveBlob: async () => undefined,
      }),
    ).rejects.toThrow("无法读取引用图片文件，请重新生成或导入图片。");
  });

  it("throws when total size exceeds 20MB", async () => {
    // 21MB blob
    const bigBlob = new Blob([new Uint8Array(21 * 1024 * 1024)]);
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["img-1"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        imageById: () => makeImage(),
        resolveBlob: async () => bigBlob,
      }),
    ).rejects.toThrow(/超过 20MB 上限/);
  });

  it("throws when mask is not PNG", async () => {
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["img-1"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        editSourceImageId: "img-1",
        editMaskImageId: "mask-1",
        imageById: (id) =>
          id === "mask-1" ? makeImage({ id: "mask-1", mimeType: "image/jpeg" }) : makeImage(),
        resolveBlob: async (img) =>
          new Blob(["x"], { type: img?.mimeType ?? "image/png" }),
      }),
    ).rejects.toThrow("编辑遮罩必须是 PNG 文件，请重新选择编辑区域。");
  });

  it("throws when editSourceImageId is not in references", async () => {
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["img-1"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        editSourceImageId: "img-other",
        imageById: (id) => makeImage({ id }),
        resolveBlob: async () => new Blob(["x"]),
      }),
    ).rejects.toThrow("编辑源图不在当前引用列表中，请重新选择继续编辑。");
  });

  it("throws when mask specified without source image", async () => {
    await expect(
      resolveImageEditRequest({
        prompt: "edit",
        references: ["img-1"],
        params: PARAMS,
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
        editMaskImageId: "mask-1",
        imageById: (id) => makeImage({ id }),
        resolveBlob: async () => new Blob(["x"], { type: "image/png" }),
      }),
    ).rejects.toThrow("缺少编辑源图，无法使用局部编辑。");
  });

  it("passes through prompt / params / promptRequestSettings", async () => {
    const result = await resolveImageEditRequest({
      prompt: "my prompt",
      references: ["img-1"],
      params: PARAMS,
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      imageById: () => makeImage(),
      resolveBlob: async () => new Blob(["x"]),
    });
    expect(result.prompt).toBe("my prompt");
    expect(result.params).toBe(PARAMS);
    expect(result.promptRequestSettings).toBe(PROMPT_REQUEST_SETTINGS);
  });

  it("filters images to editSourceImageId when specified", async () => {
    const result = await resolveImageEditRequest({
      prompt: "edit",
      references: ["img-1", "img-2"],
      params: PARAMS,
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      editSourceImageId: "img-2",
      imageById: (id) => makeImage({ id, name: id }),
      resolveBlob: async () => new Blob(["x"]),
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].name).toBe("img-2.png");
  });

  it("handles empty Blob (size === 0) without throwing", async () => {
    const emptyBlob = new Blob([], { type: "image/png" });
    const result = await resolveImageEditRequest({
      prompt: "edit",
      references: ["img-1"],
      params: PARAMS,
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      imageById: () => makeImage(),
      resolveBlob: async () => emptyBlob,
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0].blob.size).toBe(0);
  });
});
