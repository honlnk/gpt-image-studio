import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../urlToB64.js", () => ({ urlToB64: vi.fn() }));

import { glmAdapter, normalizeGlmSize } from "../adapters/glm.js";
import { urlToB64 } from "../urlToB64.js";
import type { ProviderConfig, SizeConstraints } from "../types.js";

const urlToB64Mock = vi.mocked(urlToB64);

const CONSTRAINTS: SizeConstraints = {
  step: 32,
  min: 512,
  max: 2048,
  maxPixels: 4194304,
  minPixels: 0,
  maxAspectRatio: null,
  defaultSize: "1280x1280",
};

const CONFIG: ProviderConfig = {
  provider: "glm",
  apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4/images",
  apiKey: "glm-test-key",
  model: "glm-image",
};

describe("normalizeGlmSize", () => {
  it("maps auto to default size", () => {
    expect(normalizeGlmSize("auto", CONSTRAINTS)).toBe("1280x1280");
  });

  it("maps empty string to default size", () => {
    expect(normalizeGlmSize("", CONSTRAINTS)).toBe("1280x1280");
  });

  it("passes through a valid WxH", () => {
    expect(normalizeGlmSize("1024x1024", CONSTRAINTS)).toBe("1024x1024");
    expect(normalizeGlmSize("1280x768", CONSTRAINTS)).toBe("1280x768");
  });

  it("aligns to step 32", () => {
    // 1000 不是 32 倍数 → 规整到最近的 32 倍数
    expect(normalizeGlmSize("1000x1000", CONSTRAINTS)).toBe("992x992");
  });

  it("clamps below min to 512", () => {
    expect(normalizeGlmSize("256x256", CONSTRAINTS)).toBe("512x512");
  });

  it("clamps above max to 2048", () => {
    expect(normalizeGlmSize("4096x4096", CONSTRAINTS)).toBe("2048x2048");
  });

  it("compresses pixels below maxPixels (long side first)", () => {
    // 2048x2048 = 4194304 正好等于上限，不压缩
    expect(normalizeGlmSize("2048x2048", CONSTRAINTS)).toBe("2048x2048");
    // 极端横向比例：宽边会被压下来以满足像素上限
    const result = normalizeGlmSize("16:9", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(w * h).toBeLessThanOrEqual(4194304);
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
    expect(w).toBeGreaterThanOrEqual(512);
    expect(h).toBeGreaterThanOrEqual(512);
  });

  it("handles ratio format (16:9)", () => {
    const result = normalizeGlmSize("16:9", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    // 16:9 → 宽边更长
    expect(w).toBeGreaterThan(h);
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
  });

  it("handles ratio format (9:16 portrait)", () => {
    const result = normalizeGlmSize("9:16", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(h).toBeGreaterThan(w);
  });

  it("accepts unicode × separator", () => {
    expect(normalizeGlmSize("1024×1024", CONSTRAINTS)).toBe("1024x1024");
  });

  it("falls back to default for unrecognizable size", () => {
    expect(normalizeGlmSize("bogus", CONSTRAINTS)).toBe("1280x1280");
  });

  it("output always uses lowercase x separator", () => {
    const result = normalizeGlmSize("16:9", CONSTRAINTS);
    expect(result).toMatch(/^\d+x\d+$/);
  });
});

describe("glmAdapter.generate", () => {
  beforeEach(() => {
    urlToB64Mock.mockResolvedValue({
      b64Json: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
      mimeType: "image/png",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(
          "https://open.bigmodel.cn/api/paas/v4/images/generations",
        );
        const body = JSON.parse(String(init.body));
        // GLM 只认 model/prompt/size，background/output_format 应被裁掉
        expect(body).toEqual({
          model: "glm-image",
          prompt: "a cat",
          size: "1280x1280",
        });
        expect(body.background).toBeUndefined();
        expect(body.output_format).toBeUndefined();
        return new Response(
          JSON.stringify({
            data: [{ url: "https://cdn.example.com/img.png" }],
          }),
          { status: 200 },
        );
      }),
    );
  });
  afterEach(() => {
    urlToB64Mock.mockReset();
    vi.unstubAllGlobals();
  });

  it("translates request, fetches url, returns b64", async () => {
    const result = await glmAdapter.generate(
      {
        model: "glm-image",
        prompt: "a cat",
        size: "auto",
        background: "opaque",
        outputFormat: "png",
        extra: { quality: "high" }, // extra 应被裁掉
      },
      CONFIG,
    );

    expect(result.b64Json).toBe(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
    );
    // signal 透传：未传 options 时 urlToB64 收到 { signal: undefined }
    expect(urlToB64Mock).toHaveBeenCalledWith("https://cdn.example.com/img.png", {
      signal: undefined,
    });
  });

  it("classifies fetch throw as reset category", async () => {
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(networkError)),
    );
    await expect(
      glmAdapter.generate(
        {
          model: "glm-image",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toMatchObject({ category: "reset" });
  });

  it("throws upstream error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "prompt 违规" } }), {
            status: 400,
          }),
      ),
    );
    await expect(
      glmAdapter.generate(
        {
          model: "glm-image",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("prompt 违规");
  });

  it("throws when response has no url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
      ),
    );
    await expect(
      glmAdapter.generate(
        {
          model: "glm-image",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow(/data\[0\]\.url|没有/);
  });
});

describe("glmAdapter static metadata", () => {
  it("declares GLM capability (no edit/mask, no transparent, no webp)", () => {
    expect(glmAdapter.capability).toEqual({
      generate: true,
      edit: false,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg"],
    });
  });

  it("declares GLM size constraints", () => {
    expect(glmAdapter.sizeConstraints).toEqual({
      step: 32,
      min: 512,
      max: 2048,
      maxPixels: 4194304,
      minPixels: 0,
      maxAspectRatio: null,
      defaultSize: "1280x1280",
    });
  });

  it("declares resolution options [1k, 2k] (GLM maxPixels=4M, no 4k)", () => {
    expect(glmAdapter.resolutionOptions.map((o) => o.value)).toEqual(["1k", "2k"]);
    expect(glmAdapter.resolutionOptions.find((o) => o.value === "4k")).toBeUndefined();
  });
});
