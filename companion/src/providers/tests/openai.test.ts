import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { openaiAdapter } from "../adapters/openai.js";
import type { ProviderConfig } from "../types.js";

const CONFIG: ProviderConfig = {
  provider: "openai",
  apiBaseUrl: "https://api.example.com/v1/images",
  apiKey: "sk-test",
  model: "gpt-image-2",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("openaiAdapter.generate", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        return jsonResponse(200, {
          data: [{ b64_json: "Z2VuZXJhdGVk", revised_prompt: "a cat" }],
          _echo: body, // 回显收到的 body，方便断言
        });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards known fields as OpenAI-shaped keys", async () => {
    const result = await openaiAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "a cat",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    expect(result).toEqual({ b64Json: "Z2VuZXJhdGVk", revisedPrompt: "a cat" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.example.com/v1/images/generations");
    const sentBody = JSON.parse(String((call[1] as RequestInit).body));
    expect(sentBody).toMatchObject({
      model: "gpt-image-2",
      prompt: "a cat",
      size: "1024x1024",
      background: "auto",
      output_format: "png",
    });
  });

  it("preserves extra fields (quality / stream / partial_images) — zero field-drop regression", async () => {
    const result = await openaiAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "a cat",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: { quality: "high", stream: true, partial_images: 2 },
      },
      CONFIG,
    );

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse(String((call[1] as RequestInit).body));
    // 额外字段必须原样透传，与原 routes/images.ts 的 JSON.stringify(body) 行为等价
    expect(sentBody).toMatchObject({
      quality: "high",
      stream: true,
      partial_images: 2,
      model: "gpt-image-2",
      prompt: "a cat",
    });
    expect(result.b64Json).toBe("Z2VuZXJhdGVk");
  });

  it("strips trailing slashes from apiBaseUrl", async () => {
    await openaiAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "x",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      { ...CONFIG, apiBaseUrl: "https://api.example.com/v1/images///" },
    );

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.example.com/v1/images/generations");
  });
});

describe("openaiAdapter error handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws upstream error.message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: { message: "bad prompt" } })),
    );
    await expect(
      openaiAdapter.generate(
        {
          model: "gpt-image-2",
          prompt: "x",
          size: "1024x1024",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("bad prompt");
  });

  it("classifies fetch throw as reset category", async () => {
    // 真实 Node fetch 在 ECONNRESET 时抛带 code 的 Error，这里模拟该形态
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(networkError)));
    await expect(
      openaiAdapter.generate(
        {
          model: "gpt-image-2",
          prompt: "x",
          size: "1024x1024",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toMatchObject({ category: "reset" });
  });

  it("throws when 2xx response has no b64_json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { data: [{}] })),
    );
    await expect(
      openaiAdapter.generate(
        {
          model: "gpt-image-2",
          prompt: "x",
          size: "1024x1024",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("data[0].b64_json");
  });
});

describe("openaiAdapter static metadata", () => {
  it("declares full OpenAI capability", () => {
    expect(openaiAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: true,
      // gpt-image-2 不支持 transparent，与 web 现状一致
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "webp", "jpeg"],
    });
  });

  it("declares OpenAI size constraints matching web's hardcoded constants", () => {
    // 这组数字必须与 web 侧 imagesApi.ts getCustomSizeError 完全一致，
    // 阶段一后 web 改读本字段，语义零变化。
    expect(openaiAdapter.sizeConstraints).toEqual({
      step: 16,
      min: 16,
      max: 3840,
      maxPixels: 8294400,
      minPixels: 655360,
      maxAspectRatio: 3,
      defaultSize: "1024x1024",
    });
  });

  it("declares resolution options [1k, 2k, 4k] (OpenAI full range)", () => {
    expect(openaiAdapter.resolutionOptions.map((o) => o.value)).toEqual([
      "1k",
      "2k",
      "4k",
    ]);
  });
});
