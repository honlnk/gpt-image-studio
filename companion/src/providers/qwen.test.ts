import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./urlToB64.js", () => ({ urlToB64: vi.fn() }));

import { normalizeQwenSize, qwenAdapter } from "./qwen.js";
import { urlToB64 } from "./urlToB64.js";
import type { ProviderConfig, SizeConstraints } from "./types.js";

const urlToB64Mock = vi.mocked(urlToB64);

const CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 512,
  max: 8192,
  maxPixels: 4194304,
  minPixels: 262144,
  maxAspectRatio: null,
  defaultSize: "2048x2048",
};

const CONFIG: ProviderConfig = {
  provider: "qwen",
  apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
  apiKey: "qwen-test-key",
  model: "qwen-image-2.0-pro",
};

function dashscopeImageResponse(url = "https://cdn.example.com/qwen.png") {
  return {
    output: {
      choices: [
        {
          message: {
            content: [{ image: url }],
          },
        },
      ],
    },
  };
}

describe("normalizeQwenSize", () => {
  it("maps auto and empty to default size in DashScope star format", () => {
    expect(normalizeQwenSize("auto", CONSTRAINTS)).toBe("2048*2048");
    expect(normalizeQwenSize("", CONSTRAINTS)).toBe("2048*2048");
  });

  it("accepts x, unicode ×, and star separators", () => {
    expect(normalizeQwenSize("1024x1024", CONSTRAINTS)).toBe("1024*1024");
    expect(normalizeQwenSize("1024×1024", CONSTRAINTS)).toBe("1024*1024");
    expect(normalizeQwenSize("1024*1024", CONSTRAINTS)).toBe("1024*1024");
  });

  it("clamps dimensions into Qwen range", () => {
    expect(normalizeQwenSize("256x256", CONSTRAINTS)).toBe("512*512");
    expect(normalizeQwenSize("4096x4096", CONSTRAINTS)).toBe("2048*2048");
  });

  it("keeps valid wide size within Qwen total pixel range", () => {
    expect(normalizeQwenSize("2730x1536", CONSTRAINTS)).toBe("2730*1536");
  });

  it("handles ratio format", () => {
    const result = normalizeQwenSize("16:9", CONSTRAINTS);
    const [w, h] = result.split("*").map(Number);
    expect(w).toBeGreaterThan(h);
    expect(w).toBeLessThanOrEqual(CONSTRAINTS.max);
    expect(h).toBeGreaterThanOrEqual(CONSTRAINTS.min);
    expect(w * h).toBeLessThanOrEqual(CONSTRAINTS.maxPixels);
  });

  it("falls back to default for unrecognizable size", () => {
    expect(normalizeQwenSize("bogus", CONSTRAINTS)).toBe("2048*2048");
  });
});

describe("qwenAdapter.generate", () => {
  afterEach(() => {
    urlToB64Mock.mockReset();
    vi.unstubAllGlobals();
  });

  it("posts DashScope multimodal request, downloads returned image URL, and returns b64", async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    urlToB64Mock.mockResolvedValue({ b64Json: imageBytes.toString("base64"), mimeType: "image/png" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      );
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer qwen-test-key");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
        model: "qwen-image-2.0-pro",
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: "a sign with Chinese text" }],
            },
          ],
        },
        parameters: { size: "2048*2048" },
      });
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await qwenAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "a sign with Chinese text",
        size: "auto",
        background: "opaque",
        outputFormat: "png",
        extra: { quality: "high" },
      },
      CONFIG,
    );

    expect(result.b64Json).toBe(imageBytes.toString("base64"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(urlToB64Mock).toHaveBeenCalledWith("https://cdn.example.com/qwen.png");
  });

  it("throws upstream error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "InvalidParameter", message: "bad size" }), {
            status: 400,
          }),
      ),
    );

    await expect(
      qwenAdapter.generate(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("bad size");
  });

  it("throws when response has no image URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ output: { choices: [] } }), { status: 200 })),
    );

    await expect(
      qwenAdapter.generate(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow(/Qwen-Image 响应中没有/);
  });
});

describe("qwenAdapter.edit", () => {
  afterEach(() => {
    urlToB64Mock.mockReset();
    vi.unstubAllGlobals();
  });

  it("posts image data URLs before text prompt", async () => {
    const imageBytes = Buffer.from([0x01, 0x02, 0x03]);
    const reference = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    urlToB64Mock.mockResolvedValue({ b64Json: imageBytes.toString("base64"), mimeType: "image/png" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(url).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      );
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("qwen-image-2.0-pro");
      expect(body.parameters).toEqual({ size: "1024*1024" });
      expect(body.input.messages[0].content).toEqual([
        { image: `data:image/png;base64,${reference.toString("base64")}` },
        { text: "把招牌改成中文" },
      ]);
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await qwenAdapter.edit!(
      {
        model: "gpt-image-2",
        prompt: "把招牌改成中文",
        size: "1024x1024",
        background: "auto",
        outputFormat: "png",
        extra: {},
        images: [{ blob: reference, name: "ref.png", mimeType: "image/png" }],
        editExtra: { quality: "high" },
      },
      CONFIG,
    );

    expect(result.b64Json).toBe(imageBytes.toString("base64"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(urlToB64Mock).toHaveBeenCalledWith("https://cdn.example.com/qwen.png");
  });

  it("throws when no reference image provided", async () => {
    await expect(
      qwenAdapter.edit!(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images: [],
          editExtra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("至少一张参考图");
  });

  it("throws when more than 3 reference images are provided", async () => {
    const images = Array.from({ length: 4 }, (_, index) => ({
      blob: Buffer.from([index]),
      name: `${index}.png`,
      mimeType: "image/png",
    }));

    await expect(
      qwenAdapter.edit!(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images,
          editExtra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("最多支持 3 张参考图");
  });
});

describe("qwenAdapter static metadata", () => {
  it("declares Qwen capability", () => {
    expect(qwenAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto"],
      outputFormats: ["png"],
    });
  });

  it("declares Qwen size constraints and resolution options", () => {
    expect(qwenAdapter.sizeConstraints).toEqual({
      step: 1,
      min: 512,
      max: 8192,
      maxPixels: 4194304,
      minPixels: 262144,
      maxAspectRatio: null,
      defaultSize: "2048x2048",
    });
    expect(qwenAdapter.resolutionOptions.map((option) => option.value)).toEqual([
      "1k",
      "2k",
    ]);
  });
});
