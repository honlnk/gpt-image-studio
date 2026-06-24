import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  editImage,
  generateImage,
  getCustomSizeError,
} from "./imagesApi";
import type { SizeConstraints } from "./imagesApi";
import type { GenerationParams } from "../types/studio";

const OPENAI_CONSTRAINTS: SizeConstraints = {
  step: 16,
  min: 16,
  max: 3840,
  maxPixels: 8294400,
  minPixels: 655360,
  maxAspectRatio: 3,
  defaultSize: "1024x1024",
};

const GLM_CONSTRAINTS: SizeConstraints = {
  step: 32,
  min: 512,
  max: 2048,
  maxPixels: 4194304,
  minPixels: 0,
  maxAspectRatio: null,
  defaultSize: "1280x1280",
};

const generationParams: GenerationParams = {
  size: "1:1",
  resolution: "1k",
  width: 1024,
  height: 1024,
  imageCount: 1,
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
    expect(requestBody.response_format).toBeUndefined();
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

  it("applies prompt mode before the prompt rewrite guard", async () => {
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
      promptMode: "creative",
      promptRewriteGuardEnabled: true,
      params: generationParams,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.prompt).toContain(`${PROMPT_REWRITE_GUARD_PREFIX}\n`);
    expect(requestBody.prompt).toContain("当前模式：创意");
    expect(requestBody.prompt).toContain("用户原始提示词：\n画一张图");
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
    expect((requestBody as FormData).has("response_format")).toBe(false);
    expect((requestBody as FormData).has("quality")).toBe(false);
  });

  it("calls the Responses API with the image_generation tool", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        output: [
          {
            type: "image_generation_call",
            result: { b64_json: "responses-image" },
            revised_prompt: "responses rewrite",
          },
        ],
      }),
    );

    await expect(
      generateImage({
        apiBaseUrl: "https://api.example.test/v1",
        apiBaseUrlMode: "full",
        apiMode: "responses",
        apiKey: "sk-test",
        model: "gpt-5.5",
        prompt: "画一张图",
        params: generationParams,
      }),
    ).resolves.toEqual({
      b64Json: "responses-image",
      revisedPrompt: "responses rewrite",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/responses");
    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody).toMatchObject({
      model: "gpt-5.5",
      input: "画一张图",
      tool_choice: "required",
    });
    expect(requestBody.tools).toEqual([
      expect.objectContaining({
        type: "image_generation",
        action: "generate",
        size: "1024x1024",
        quality: "auto",
        background: "auto",
        output_format: "png",
      }),
    ]);
  });

  it("parses Images API streaming responses and emits partial previews", async () => {
    const onPartialImage = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      eventStreamResponse([
        {
          type: "image_generation.partial_image",
          b64_json: "partial-image",
          partial_image_index: 1,
        },
        {
          type: "image_generation.completed",
          b64_json: "final-image",
          revised_prompt: "stream rewrite",
        },
      ]),
    );

    await expect(
      generateImage({
        apiBaseUrl: "https://api.example.test/v1/images",
        apiBaseUrlMode: "full",
        apiKey: "sk-test",
        model: "gpt-image-2",
        prompt: "画一张图",
        streamImages: true,
        streamPartialImages: 2,
        onPartialImage,
        params: generationParams,
      }),
    ).resolves.toEqual({
      b64Json: "final-image",
      revisedPrompt: "stream rewrite",
    });

    expect(onPartialImage).toHaveBeenCalledWith({
      b64Json: "partial-image",
      partialImageIndex: 1,
    });
  });

  it("parses Responses API streaming responses and emits partial previews", async () => {
    const onPartialImage = vi.fn();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      eventStreamResponse([
        {
          type: "response.image_generation_call.partial_image",
          partial_image_b64: "partial-image",
          partial_image_index: 2,
        },
        {
          type: "response.output_item.done",
          item: {
            type: "image_generation_call",
            result: { b64_json: "final-image" },
            revised_prompt: "responses stream rewrite",
          },
        },
      ]),
    );

    await expect(
      generateImage({
        apiBaseUrl: "https://api.example.test",
        apiBaseUrlMode: "origin",
        apiMode: "responses",
        apiKey: "sk-test",
        model: "gpt-5.5",
        prompt: "画一张图",
        streamImages: true,
        streamPartialImages: 2,
        onPartialImage,
        params: generationParams,
      }),
    ).resolves.toEqual({
      b64Json: "final-image",
      revisedPrompt: "responses stream rewrite",
    });

    expect(onPartialImage).toHaveBeenCalledWith({
      b64Json: "partial-image",
      partialImageIndex: 2,
    });
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

  it("keeps the HTTP status in API error messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: { message: "Invalid bearer token" },
        },
        401,
      ),
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
    ).rejects.toThrow("请求失败：HTTP 401：Invalid bearer token");
  });
});

describe("getCustomSizeError", () => {
  it("requires integer dimensions", () => {
    expect(getCustomSizeError(1024.5, 1024, OPENAI_CONSTRAINTS)).toBe("自定义尺寸的宽高必须是整数。");
    expect(getCustomSizeError(Number.NaN, 1024, OPENAI_CONSTRAINTS)).toBe("自定义尺寸的宽高必须是整数。");
  });

  it("requires dimensions between 16 and 3840 in 16px increments (OpenAI)", () => {
    expect(getCustomSizeError(15, 1024, OPENAI_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
    expect(getCustomSizeError(3856, 1024, OPENAI_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
    expect(getCustomSizeError(1025, 1024, OPENAI_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 16 到 3840 之间的 16 的倍数。",
    );
  });

  it("requires total pixels within the supported range (OpenAI)", () => {
    expect(getCustomSizeError(256, 256, OPENAI_CONSTRAINTS)).toBe(
      "自定义尺寸的总像素必须在 655,360 到 8,294,400 之间。",
    );
    expect(getCustomSizeError(3840, 3840, OPENAI_CONSTRAINTS)).toBe(
      "自定义尺寸的总像素必须在 655,360 到 8,294,400 之间。",
    );
  });

  it("rejects dimensions with an aspect ratio greater than 3:1 (OpenAI)", () => {
    expect(getCustomSizeError(2048, 512, OPENAI_CONSTRAINTS)).toBe("自定义尺寸的长边与短边比例不能超过 3:1。");
  });

  it("allows valid dimensions (OpenAI)", () => {
    expect(getCustomSizeError(1024, 1024, OPENAI_CONSTRAINTS)).toBe("");
    expect(getCustomSizeError(1536, 1024, OPENAI_CONSTRAINTS)).toBe("");
    expect(getCustomSizeError(1920, 1088, OPENAI_CONSTRAINTS)).toBe("");
  });

  it("enforces GLM constraints: 512-2048, step 32", () => {
    expect(getCustomSizeError(256, 1024, GLM_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 512 到 2048 之间的 32 的倍数。",
    );
    expect(getCustomSizeError(4096, 1024, GLM_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 512 到 2048 之间的 32 的倍数。",
    );
    // 1000 不是 32 倍数（1000 / 32 = 31.25）
    expect(getCustomSizeError(1000, 1000, GLM_CONSTRAINTS)).toBe(
      "自定义尺寸的宽高必须是 512 到 2048 之间的 32 的倍数。",
    );
  });

  it("GLM has no aspect ratio limit (maxAspectRatio=null)", () => {
    // 2048x512 = 4:1，OpenAI 会拒绝，GLM 只检查像素和范围
    // 2048x512 = 1048576 像素 < 4194304，且都在 512-2048、step32 → 合法
    expect(getCustomSizeError(2048, 512, GLM_CONSTRAINTS)).toBe("");
  });

  it("GLM enforces maxPixels 4194304", () => {
    // 2048x2048 = 4194304 正好等于上限，合法
    expect(getCustomSizeError(2048, 2048, GLM_CONSTRAINTS)).toBe("");
  });

  it("GLM allows valid dimensions", () => {
    expect(getCustomSizeError(1280, 1280, GLM_CONSTRAINTS)).toBe("");
    expect(getCustomSizeError(1024, 576, GLM_CONSTRAINTS)).toBe("");
  });

  it("Doubao enforces minPixels floor (3686400), no step constraint", () => {
    // 豆包 step=1 → 无步长对齐，任意整数像素都接受（单边范围由 min/max 兜底）
    const DOUBAO_CONSTRAINTS: SizeConstraints = {
      step: 1,
      min: 512,
      max: 4096,
      maxPixels: 16777216,
      minPixels: 3686400,
      maxAspectRatio: 16,
      defaultSize: "2048x2048",
    };
    // 1024x1024 = 1048576 < minPixels 3686400 → 报总像素下限错
    expect(getCustomSizeError(1024, 1024, DOUBAO_CONSTRAINTS)).toContain("总像素");
    // 1920x1920 = 3686400 刚好等于下限 → 合法
    expect(getCustomSizeError(1920, 1920, DOUBAO_CONSTRAINTS)).toBe("");
    // 2048x2048 = 4194304 在范围内 → 合法
    expect(getCustomSizeError(2048, 2048, DOUBAO_CONSTRAINTS)).toBe("");
    // step=1：2345x2345 这种非步长倍数也合法（只要像素在范围）
    expect(getCustomSizeError(2345, 2345, DOUBAO_CONSTRAINTS)).toBe("");
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function eventStreamResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
