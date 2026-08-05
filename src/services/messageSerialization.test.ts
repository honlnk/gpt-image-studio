import { describe, expect, it } from "vitest";
import { toPlainImageAsset, toPlainMessage } from "./messageSerialization";
import type { ImageAsset, Message } from "../types/studio";

describe("toPlainMessage", () => {
  it("returns a deep copy that does not share array references", () => {
    const message: Message = {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "hi",
      referencedImageIds: ["a"],
      resultImageIds: ["b"],
      status: "success",
      createdAt: "2024-01-01",
      generationParams: {
        size: "custom",
        width: 1024,
        height: 1024,
        resolution: "1k",
        quality: "high",
        background: "auto",
        outputFormat: "png",
        imageCount: 1,
      },
    };
    const plain = toPlainMessage(message);
    expect(plain).not.toBe(message);
    expect(plain.referencedImageIds).not.toBe(message.referencedImageIds);
    expect(plain.referencedImageIds).toEqual(message.referencedImageIds);
    expect(plain.resultImageIds).not.toBe(message.resultImageIds);
    expect(plain.generationParams).not.toBe(message.generationParams);
  });

  it("preserves promptRequestSettings via deep clone", () => {
    const message = {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "hi",
      referencedImageIds: [],
      resultImageIds: [],
      status: "success" as const,
      createdAt: "2024-01-01",
      promptRequestSettings: {
        promptMode: "default" as const,
        promptWordbanks: {
          pose: { safe: ["x"], creative: [], nsfw: [] },
          adultInspiration: [],
        },
        promptRewriteGuardEnabled: true,
        promptRewriteGuardText: "guard",
      },
    } as Message;
    const plain = toPlainMessage(message);
    expect(plain.promptRequestSettings?.promptWordbanks).not.toBe(
      message.promptRequestSettings?.promptWordbanks,
    );
    expect(plain.promptRequestSettings?.promptWordbanks.pose.safe).not.toBe(
      message.promptRequestSettings?.promptWordbanks.pose.safe,
    );
  });

  it("handles undefined generationParams / promptRequestSettings", () => {
    const message = {
      id: "m1",
      conversationId: "c1",
      role: "assistant",
      content: "",
      referencedImageIds: [],
      resultImageIds: [],
      status: "success",
      createdAt: "2024-01-01",
    } as Message;
    const plain = toPlainMessage(message);
    expect(plain.generationParams).toBeUndefined();
    expect(plain.promptRequestSettings).toBeUndefined();
  });

  it("preserves edit fields (editSourceImageId / editMaskImageId) and runtime fields", () => {
    const message = {
      id: "m1",
      conversationId: "c1",
      role: "assistant",
      content: "",
      referencedImageIds: [],
      resultImageIds: [],
      status: "error",
      createdAt: "2024-01-01",
      generationStartedAt: "2024-01-02",
      networkRetryAttempt: 2,
      errorMessage: "boom",
      editSourceImageId: "src-1",
      editMaskImageId: "mask-1",
    } as Message;
    const plain = toPlainMessage(message);
    expect(plain.editSourceImageId).toBe("src-1");
    expect(plain.editMaskImageId).toBe("mask-1");
    expect(plain.networkRetryAttempt).toBe(2);
    expect(plain.errorMessage).toBe("boom");
    expect(plain.generationStartedAt).toBe("2024-01-02");
    expect(plain.status).toBe("error");
  });
});

describe("toPlainImageAsset", () => {
  it("returns a deep copy without previewUrl (runtime-only field)", () => {
    const asset = {
      id: "img1",
      blobKey: "blob1",
      name: "art.png",
      source: "generated" as const,
      tagColor: "blue" as const,
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      sizeBytes: 1024,
      conversationId: "c1",
      messageId: "m1",
      prompt: "a cat",
      referencedImageIds: ["ref1"],
      generationDurationMs: 5000,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-02",
    } as ImageAsset;
    const plain = toPlainImageAsset(asset);
    expect(plain).not.toBe(asset);
    expect(plain.referencedImageIds).not.toBe(asset.referencedImageIds);
    expect(plain.referencedImageIds).toEqual(asset.referencedImageIds);
    // previewUrl 不应在序列化结果里
    expect("previewUrl" in plain).toBe(false);
  });

  it("handles undefined referencedImageIds", () => {
    const asset = {
      id: "img1",
      blobKey: "blob1",
      name: "art",
      source: "generated",
      tagColor: "blue",
      mimeType: "image/png",
      width: 100,
      height: 100,
      sizeBytes: 0,
      conversationId: "c1",
      messageId: "m1",
      prompt: "",
      generationDurationMs: 0,
      createdAt: "",
      updatedAt: "",
    } as ImageAsset;
    const plain = toPlainImageAsset(asset);
    expect(plain.referencedImageIds).toBeUndefined();
  });
});
