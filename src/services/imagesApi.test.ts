import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  editImage,
  generateImage,
  getCustomSizeError,
} from "./imagesApi";
import type { GenerationParams } from "../types/studio";

const generationParams: GenerationParams = {
  size: "1:1",
  resolution: "1k",
  width: 1024,
  height: 1024,
  quality: "auto",
  background: "auto",
  outputFormat: "png",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("images API requests", () => {
  it("requests base64 JSON for image generation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await expect(
      generateImage({
        apiBaseUrl: "https://api.example.test/v1/images",
        apiBaseUrlMode: "full",
        apiKey: "sk-test",
        model: "gpt-image-2",
        prompt: "画一张图",
        params: generationParams,
      }),
    ).resolves.toEqual({
      b64Json: "generated-image",
      revisedPrompt: undefined,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/images/generations");
    expect(requestBody.response_format).toBe("b64_json");
    expect(requestBody.quality).toBeUndefined();
  });

  it("appends the Images API path when API base URL is configured as an origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await generateImage({
      apiBaseUrl: "https://api.example.test",
      apiBaseUrlMode: "origin",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "画一张图",
      params: generationParams,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/images/generations");
  });

  it("normalizes extra trailing slashes before appending the Images API path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await generateImage({
      apiBaseUrl: "https://api.example.test///",
      apiBaseUrlMode: "origin",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "画一张图",
      params: generationParams,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/images/generations");
  });

  it("adds the prompt rewrite guard when enabled for image generation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await generateImage({
      apiBaseUrl: "https://api.example.test/v1/images",
      apiBaseUrlMode: "full",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "画一张图",
      promptRewriteGuardEnabled: true,
      params: generationParams,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.prompt).toBe(`${PROMPT_REWRITE_GUARD_PREFIX}\n画一张图`);
  });

  it("uses custom prompt rewrite guard text when provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await generateImage({
      apiBaseUrl: "https://api.example.test/v1/images",
      apiBaseUrlMode: "full",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "画一张图",
      promptRewriteGuardEnabled: true,
      promptRewriteGuardText: "请不要改写下面的提示词：",
      params: generationParams,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.prompt).toBe("请不要改写下面的提示词：\n画一张图");
  });

  it("converts ratio size presets to calculated dimensions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "generated-image" }],
      }),
    );

    await generateImage({
      apiBaseUrl: "https://api.example.test/v1/images",
      apiBaseUrlMode: "full",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "画一张图",
      params: {
        ...generationParams,
        size: "16:9",
        width: 1920,
        height: 1088,
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.size).toBe("1920x1088");
  });

  it("requests base64 JSON for image edits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "edited-image", revised_prompt: "rewritten edit" }],
      }),
    );

    await expect(
      editImage({
        apiBaseUrl: "https://api.example.test/v1/images",
        apiBaseUrlMode: "full",
        apiKey: "sk-test",
        model: "gpt-image-2",
        prompt: "改一下图",
        params: generationParams,
        images: [
          {
            blob: new Blob(["image"], { type: "image/png" }),
            name: "image.png",
          },
        ],
      }),
    ).resolves.toEqual({
      b64Json: "edited-image",
      revisedPrompt: "rewritten edit",
    });

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeInstanceOf(FormData);
    expect((requestBody as FormData).get("response_format")).toBe("b64_json");
    expect((requestBody as FormData).has("quality")).toBe(false);
  });

  it("adds the prompt rewrite guard when enabled for image edits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "edited-image" }],
      }),
    );

    await editImage({
      apiBaseUrl: "https://api.example.test/v1/images",
      apiBaseUrlMode: "full",
      apiKey: "sk-test",
      model: "gpt-image-2",
      prompt: "改一下图",
      promptRewriteGuardEnabled: true,
      params: generationParams,
      images: [
        {
          blob: new Blob(["image"], { type: "image/png" }),
          name: "image.png",
        },
      ],
    });

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("prompt")).toBe(`${PROMPT_REWRITE_GUARD_PREFIX}\n改一下图`);
  });
});

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

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
