import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { deepinfraAdapter, normalizeDeepInfraSize } from "../adapters/deepinfra.js";
import type { ProviderConfig } from "../types.js";

const CONFIG: ProviderConfig = {
  provider: "deepinfra",
  apiBaseUrl: "https://api.deepinfra.com/v1/openai/images",
  apiKey: "di-test",
  model: "black-forest-labs/FLUX-1.1-pro",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("deepinfraAdapter.generate", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        return jsonResponse(200, {
          data: [{ b64_json: "Z2VuZXJhdGVk", revised_prompt: "a cat" }],
          _echo: body,
        });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends passthrough fields + required response_format=b64_json", async () => {
    await deepinfraAdapter.generate(
      {
        model: "black-forest-labs/FLUX-1.1-pro",
        prompt: "a cat",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.deepinfra.com/v1/openai/images/generations");
    const sentBody = JSON.parse(String((call[1] as RequestInit).body));
    // passthrough 模式：model/prompt/size/background/output_format 都在
    expect(sentBody).toMatchObject({
      model: "black-forest-labs/FLUX-1.1-pro",
      prompt: "a cat",
      background: "auto",
      output_format: "png",
    });
    // requiredFields：DeepInfra 强制 response_format=b64_json
    expect(sentBody.response_format).toBe("b64_json");
    // Bearer 鉴权
    expect((call[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer di-test",
    });
  });

  it("aligns size to 32-multiple in the request", async () => {
    await deepinfraAdapter.generate(
      {
        model: "black-forest-labs/FLUX-1.1-pro",
        prompt: "a cat",
        size: "1000x1000", // 非整数倍 32，应规整为 992x992
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse(String((call[1] as RequestInit).body));
    expect(sentBody.size).toBe("992x992");
  });

  it("returns b64Json + revisedPrompt from standard data[0].b64_json", async () => {
    const result = await deepinfraAdapter.generate(
      {
        model: "black-forest-labs/FLUX-1.1-pro",
        prompt: "a cat",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    expect(result).toEqual({
      b64Json: "Z2VuZXJhdGVk",
      revisedPrompt: "a cat",
    });
  });
});

describe("deepinfraAdapter error handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws upstream error.message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: { message: "bad prompt" } })),
    );
    await expect(
      deepinfraAdapter.generate(
        {
          model: "black-forest-labs/FLUX-1.1-pro",
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

  it("throws disconnect message when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    await expect(
      deepinfraAdapter.generate(
        {
          model: "black-forest-labs/FLUX-1.1-pro",
          prompt: "x",
          size: "1024x1024",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("服务器主动断开了连接");
  });
});

describe("deepinfraAdapter static metadata", () => {
  it("declares capability from profiles/deepinfra.json", () => {
    expect(deepinfraAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg", "webp"],
    });
  });

  it("uses deepinfra size constraints (32-step, 256-1440px)", () => {
    expect(deepinfraAdapter.sizeConstraints).toMatchObject({
      step: 32,
      min: 256,
      max: 1440,
      defaultSize: "1024x1024",
    });
  });

  it("declares describe() label with provider id", () => {
    expect(deepinfraAdapter.describe(CONFIG)).toEqual({
      label: "black-forest-labs/FLUX-1.1-pro",
      providerId: "deepinfra",
    });
  });
});

describe("normalizeDeepInfraSize", () => {
  // 直接测 size 规整函数，不依赖 fetch mock
  const constraints = deepinfraAdapter.sizeConstraints;

  it("returns defaultSize for auto/empty", () => {
    expect(normalizeDeepInfraSize("auto", constraints)).toBe("1024x1024");
    expect(normalizeDeepInfraSize("", constraints)).toBe("1024x1024");
  });

  it("aligns WxH to 32-multiple and clamps to [256, 1440]", () => {
    expect(normalizeDeepInfraSize("1000x1000", constraints)).toBe("992x992");
    expect(normalizeDeepInfraSize("200x200", constraints)).toBe("256x256"); // min
    expect(normalizeDeepInfraSize("2000x2000", constraints)).toBe("1440x1440"); // max
  });

  it("computes dimensions from aspect ratio", () => {
    const result = normalizeDeepInfraSize("16:9", constraints);
    // 应是 32 的倍数，且在 [256, 1440] 内
    const match = /^(\d+)x(\d+)$/.exec(result)!;
    const [w, h] = [Number(match[1]), Number(match[2])];
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
    expect(w).toBeGreaterThanOrEqual(256);
    expect(h).toBeGreaterThanOrEqual(256);
    expect(w).toBeLessThanOrEqual(1440);
    expect(h).toBeLessThanOrEqual(1440);
  });

  it("falls back to default for unrecognizable size", () => {
    expect(normalizeDeepInfraSize("bogus", constraints)).toBe("1024x1024");
  });
});
