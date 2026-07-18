import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGeminiGenerateContentUrl,
  buildGeminiRequestBody,
  geminiAdapter,
  normalizeGeminiBaseUrl,
} from "../adapters/gemini.js";
import type { OpenAIImageEditRequest, OpenAIImageRequest, ProviderConfig } from "../types.js";

const CONFIG: ProviderConfig = {
  provider: "gemini",
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  apiKey: "gemini-test",
  model: "gemini-2.5-flash-image",
};

function baseGenerateRequest(
  overrides: Partial<OpenAIImageRequest> = {},
): OpenAIImageRequest {
  return {
    model: "gemini-2.5-flash-image",
    prompt: "画一张图",
    size: "16:9",
    resolution: "2k",
    background: "auto",
    outputFormat: "png",
    extra: {},
    ...overrides,
  };
}

function baseEditRequest(
  overrides: Partial<OpenAIImageEditRequest> = {},
): OpenAIImageEditRequest {
  return {
    model: "gemini-2.5-flash-image",
    prompt: "改一下图",
    size: "1:1",
    resolution: "1k",
    background: "auto",
    outputFormat: "png",
    extra: {},
    images: [
      { blob: Buffer.from([0x89, 0x50, 0x4e, 0x47]), name: "ref.png", mimeType: "image/png" },
    ],
    editExtra: {},
    ...overrides,
  };
}

describe("normalizeGeminiBaseUrl", () => {
  it("appends /v1beta when no version segment", () => {
    expect(normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("keeps /v1beta as-is", () => {
    expect(normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com/v1beta")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("keeps /v1 as-is", () => {
    expect(normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com/v1")).toBe(
      "https://generativelanguage.googleapis.com/v1",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com/v1beta/")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });
});

describe("buildGeminiGenerateContentUrl", () => {
  it("builds :generateContent path with encoded model", () => {
    const url = buildGeminiGenerateContentUrl(
      "https://generativelanguage.googleapis.com/v1beta",
      "gemini-2.5-flash-image",
    );
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
  });

  it("encodes special characters in model name", () => {
    const url = buildGeminiGenerateContentUrl(
      "https://generativelanguage.googleapis.com/v1beta",
      "gemini-3.1 flash",
    );
    expect(url).toContain("models/gemini-3.1%20flash:generateContent");
  });
});

describe("buildGeminiRequestBody (generate)", () => {
  it("builds contents/generationConfig with responseModalities and responseFormat.image", () => {
    const body = buildGeminiRequestBody("画一张图", "16:9", "2k");
    expect(body).toEqual({
      contents: [{ parts: [{ text: "画一张图" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            aspectRatio: "16:9",
            imageSize: "2K",
          },
        },
      },
    });
  });

  it("uses camelCase for responseFormat.image fields", () => {
    const body = buildGeminiRequestBody("test", "9:16", "1k");
    const imageConfig = (body.generationConfig as { responseFormat: { image: Record<string, string> } }).responseFormat.image;
    expect(imageConfig).toHaveProperty("aspectRatio");
    expect(imageConfig).toHaveProperty("imageSize");
    expect(imageConfig).not.toHaveProperty("aspect_ratio");
    expect(imageConfig).not.toHaveProperty("image_size");
  });

  it("uppercases imageSize (2k → 2K)", () => {
    const body = buildGeminiRequestBody("test", "1:1", "2k");
    const imageConfig = (body.generationConfig as { responseFormat: { image: { imageSize: string } } }).responseFormat.image;
    expect(imageConfig.imageSize).toBe("2K");
  });

  it("passes 512 imageSize through unchanged (512 → 512)", () => {
    const body = buildGeminiRequestBody("test", "1:1", "512");
    const imageConfig = (body.generationConfig as { responseFormat: { image: { imageSize: string } } }).responseFormat.image;
    expect(imageConfig.imageSize).toBe("512");
  });

  it("omits responseFormat when no aspectRatio and no resolution", () => {
    const body = buildGeminiRequestBody("test", "auto", undefined);
    expect(body.generationConfig).toEqual({
      responseModalities: ["TEXT", "IMAGE"],
    });
    expect((body.generationConfig as Record<string, unknown>).responseFormat).toBeUndefined();
  });

  it("omits aspectRatio for unsupported ratio", () => {
    // 9:19.5 是 Grok 支持但 Gemini 不支持的
    const body = buildGeminiRequestBody("test", "9:19.5", "1k");
    const imageConfig = (body.generationConfig as { responseFormat: { image: Record<string, unknown> } }).responseFormat.image;
    expect(imageConfig.aspectRatio).toBeUndefined();
    expect(imageConfig.imageSize).toBe("1K");
  });

  it("omits imageSize for unsupported resolution (4k not in Gemini 2.5, but 4K is declared for Gemini 3)", () => {
    const body = buildGeminiRequestBody("test", "1:1", "8k");
    const imageConfig = (body.generationConfig as { responseFormat: { image: Record<string, unknown> } }).responseFormat.image;
    expect(imageConfig.imageSize).toBeUndefined();
    expect(imageConfig.aspectRatio).toBe("1:1");
  });
});

describe("buildGeminiRequestBody (edit)", () => {
  it("appends inline_data parts in snake_case with raw base64", () => {
    const blob = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const body = buildGeminiRequestBody("改一下图", "1:1", "1k", [
      { blob, mimeType: "image/png" },
    ]);
    const parts = (body.contents as Array<{ parts: Record<string, unknown>[] }>)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: "改一下图" });
    // snake_case inline_data
    expect(parts[1]).toHaveProperty("inline_data");
    expect(parts[1]).not.toHaveProperty("inlineData");
    const inlineData = (parts[1] as { inline_data: { mime_type: string; data: string } }).inline_data;
    expect(inlineData.mime_type).toBe("image/png");
    expect(inlineData.data).toBe(blob.toString("base64"));
    // 纯 base64，不带 data: 前缀
    expect(inlineData.data).not.toContain("data:image");
  });

  it("appends multiple inline_data parts", () => {
    const body = buildGeminiRequestBody("融合", "16:9", undefined, [
      { blob: Buffer.from([0x89]), mimeType: "image/png" },
      { blob: Buffer.from([0xff]), mimeType: "image/jpeg" },
    ]);
    const parts = (body.contents as Array<{ parts: Record<string, unknown>[] }>)[0].parts;
    expect(parts).toHaveLength(3); // text + 2 images
  });
});

describe("geminiAdapter.generate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to :generateContent with x-goog-api-key header", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Image ready." },
                  { inlineData: { data: "Z2VtaW5pLWltYWdl", mimeType: "image/png" } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiAdapter.generate(baseGenerateRequest(), CONFIG);

    expect(result.b64Json).toBe("Z2VtaW5pLWltYWdl");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    // 关键：x-goog-api-key，不是 Bearer
    expect(init.headers).toEqual({
      "x-goog-api-key": "gemini-test",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body.contents).toEqual([{ parts: [{ text: "画一张图" }] }]);
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.responseFormat.image).toEqual({
      aspectRatio: "16:9",
      imageSize: "2K",
    });
  });

  it("parses snake_case inline_data in response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inline_data: { data: "c25ha2VfY2FzZQ==", mime_type: "image/jpeg" } },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await geminiAdapter.generate(baseGenerateRequest(), CONFIG);
    expect(result.b64Json).toBe("c25ha2VfY2FzZQ==");
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    await expect(geminiAdapter.generate(baseGenerateRequest(), CONFIG)).rejects.toThrow(
      "服务器主动断开了连接",
    );
  });

  it("throws upstream error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: "API key not valid" } }),
          { status: 400 },
        ),
      ),
    );
    await expect(geminiAdapter.generate(baseGenerateRequest(), CONFIG)).rejects.toThrow(
      "API key not valid",
    );
  });

  it("throws when response has no image data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "only text" }] } }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(geminiAdapter.generate(baseGenerateRequest(), CONFIG)).rejects.toThrow(
      /inlineData|candidates/i,
    );
  });
});

describe("geminiAdapter.edit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to same :generateContent with inline_data parts", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: "ZWRpdGVk", mimeType: "image/png" } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geminiAdapter.edit(baseEditRequest(), CONFIG);

    expect(result.b64Json).toBe("ZWRpdGVk");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    const body = JSON.parse(String(init.body));
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ text: "改一下图" });
    expect(parts[1].inline_data).toBeDefined();
    expect(parts[1].inline_data.mime_type).toBe("image/png");
  });

  it("throws when no reference image provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response()));
    await expect(
      geminiAdapter.edit(baseEditRequest({ images: [] }), CONFIG),
    ).rejects.toThrow("参考图");
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    await expect(geminiAdapter.edit(baseEditRequest(), CONFIG)).rejects.toThrow(
      "服务器主动断开了连接",
    );
  });
});

describe("geminiAdapter static metadata", () => {
  it("declares Gemini capability (edit=true, mask=false)", () => {
    expect(geminiAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg", "webp"],
    });
  });

  it("declares resolution options [512, 1k, 2k, 4k]", () => {
    expect(geminiAdapter.resolutionOptions.map((o) => o.value)).toEqual([
      "512",
      "1k",
      "2k",
      "4k",
    ]);
  });

  it("describe returns model or default", () => {
    expect(geminiAdapter.describe(CONFIG).label).toBe("gemini-2.5-flash-image");
    expect(geminiAdapter.describe({ ...CONFIG, model: undefined }).label).toBe(
      "gemini-2.5-flash-image",
    );
  });
});
