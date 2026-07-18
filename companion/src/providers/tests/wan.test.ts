import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../urlToB64.js", () => ({ urlToB64: vi.fn() }));

import { normalizeWanSize, wanAdapter } from "../adapters/wan.js";
import { urlToB64 } from "../urlToB64.js";
import type { ProviderConfig, SizeConstraints } from "../types.js";

const urlToB64Mock = vi.mocked(urlToB64);

const CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 768,
  max: Math.floor((2048 * 2048) / 768),
  maxPixels: 4194304,
  minPixels: 589824,
  maxAspectRatio: 8,
  defaultSize: "2048x2048",
};

const CONFIG: ProviderConfig = {
  provider: "wan",
  apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
  apiKey: "wan-test-key",
  model: "wan2.7-image",
};

const PRO_CONFIG: ProviderConfig = {
  ...CONFIG,
  model: "wan2.7-image-pro",
};

function dashscopeImageResponse(url = "https://cdn.example.com/wan.png") {
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

describe("normalizeWanSize", () => {
  it("maps auto and empty to default size in DashScope star format", () => {
    expect(normalizeWanSize("auto", CONSTRAINTS)).toBe("2048*2048");
    expect(normalizeWanSize("", CONSTRAINTS)).toBe("2048*2048");
  });

  it("accepts x, unicode ×, and star separators", () => {
    expect(normalizeWanSize("1024x1024", CONSTRAINTS)).toBe("1024*1024");
    expect(normalizeWanSize("1024×1024", CONSTRAINTS)).toBe("1024*1024");
    expect(normalizeWanSize("1024*1024", CONSTRAINTS)).toBe("1024*1024");
  });

  it("clamps dimensions into Wan pixel range", () => {
    expect(normalizeWanSize("256x256", CONSTRAINTS)).toBe("768*768");
    expect(normalizeWanSize("4096x4096", CONSTRAINTS)).toBe("2048*2048");
  });

  it("keeps valid wide size within Wan total pixel range", () => {
    expect(normalizeWanSize("2730x1536", CONSTRAINTS)).toBe("2730*1536");
  });

  it("constrains extreme aspect ratio to 8:1", () => {
    const result = normalizeWanSize("9000x900", CONSTRAINTS);
    const [w, h] = result.split("*").map(Number);
    expect(w / h).toBeLessThanOrEqual(8);
    expect(w * h).toBeLessThanOrEqual(CONSTRAINTS.maxPixels);
  });

  it("handles ratio format", () => {
    const result = normalizeWanSize("16:9", CONSTRAINTS);
    const [w, h] = result.split("*").map(Number);
    expect(w).toBeGreaterThan(h);
    expect(w).toBeLessThanOrEqual(CONSTRAINTS.max);
    expect(h).toBeGreaterThanOrEqual(CONSTRAINTS.min);
    expect(w * h).toBeLessThanOrEqual(CONSTRAINTS.maxPixels);
  });

  it("falls back to default for unrecognizable size", () => {
    expect(normalizeWanSize("bogus", CONSTRAINTS)).toBe("2048*2048");
  });
});

describe("wanAdapter.generate", () => {
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
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wan-test-key");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
        model: "wan2.7-image",
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: "一张电影感城市夜景" }],
            },
          ],
        },
        parameters: {
          size: "2048*2048",
          n: 1,
          watermark: false,
          thinking_mode: true,
        },
      });
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await wanAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "一张电影感城市夜景",
        size: "auto",
        background: "opaque",
        outputFormat: "png",
        extra: { quality: "high" },
      },
      CONFIG,
    );

    expect(result.b64Json).toBe(imageBytes.toString("base64"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(urlToB64Mock).toHaveBeenCalledWith("https://cdn.example.com/wan.png");
  });

  it("allows 4K size for wan2.7-image-pro text-to-image", async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    urlToB64Mock.mockResolvedValue({ b64Json: imageBytes.toString("base64"), mimeType: "image/png" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("wan2.7-image-pro");
      expect(body.parameters.size).toBe("4096*2304");
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await wanAdapter.generate(
      {
        model: "gpt-image-2",
        prompt: "一张电影感城市夜景",
        size: "4096x2304",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      PRO_CONFIG,
    );

    expect(result.b64Json).toBe(imageBytes.toString("base64"));
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
      wanAdapter.generate(
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
      wanAdapter.generate(
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
    ).rejects.toThrow(/Wan 响应中没有/);
  });
});

describe("wanAdapter.edit", () => {
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
      expect(body.model).toBe("wan2.7-image");
      expect(body.parameters).toEqual({
        size: "1024*1024",
        n: 1,
        watermark: false,
      });
      expect(body.input.messages[0].content).toEqual([
        { image: `data:image/png;base64,${reference.toString("base64")}` },
        { text: "把画面改成水彩风格" },
      ]);
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await wanAdapter.edit!(
      {
        model: "gpt-image-2",
        prompt: "把画面改成水彩风格",
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
    expect(urlToB64Mock).toHaveBeenCalledWith("https://cdn.example.com/wan.png");
  });

  it("throws when no reference image provided", async () => {
    await expect(
      wanAdapter.edit!(
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

  it("throws when more than 9 reference images are provided", async () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      blob: Buffer.from([index]),
      name: `${index}.png`,
      mimeType: "image/png",
    }));

    await expect(
      wanAdapter.edit!(
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
    ).rejects.toThrow("最多支持 9 张参考图");
  });

  it("normalizes near-2K rounded dimensions instead of treating them as 4K", async () => {
    const imageBytes = Buffer.from([0x01, 0x02, 0x03]);
    const reference = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    urlToB64Mock.mockResolvedValue({ b64Json: imageBytes.toString("base64"), mimeType: "image/png" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.parameters.size).toBe("3127*1341");
      return new Response(JSON.stringify(dashscopeImageResponse()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await wanAdapter.edit!(
      {
        model: "gpt-image-2",
        prompt: "保持构图，改成胶片质感",
        size: "3128x1341",
        resolution: "2k",
        background: "auto",
        outputFormat: "png",
        extra: {},
        images: [{ blob: reference, name: "ref.png", mimeType: "image/png" }],
        editExtra: {},
      },
      PRO_CONFIG,
    );

    expect(result.b64Json).toBe(imageBytes.toString("base64"));
  });

  it("rejects 4K edit for wan2.7-image-pro", async () => {
    await expect(
      wanAdapter.edit!(
        {
          model: "x",
          prompt: "x",
          size: "4096x2304",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images: [{ blob: Buffer.from([1]), name: "ref.png", mimeType: "image/png" }],
          editExtra: {},
        },
        PRO_CONFIG,
      ),
    ).rejects.toThrow("Wan 图像编辑不支持 4K 分辨率");
  });

  it("rejects explicit 4K resolution for edit even when concrete size is 2K", async () => {
    await expect(
      wanAdapter.edit!(
        {
          model: "x",
          prompt: "x",
          size: "2048x2048",
          resolution: "4k",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images: [{ blob: Buffer.from([1]), name: "ref.png", mimeType: "image/png" }],
          editExtra: {},
        },
        PRO_CONFIG,
      ),
    ).rejects.toThrow("Wan 图像编辑不支持 4K 分辨率");
  });
});

describe("wanAdapter static metadata", () => {
  it("declares Wan capability", () => {
    expect(wanAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto"],
      outputFormats: ["png"],
    });
  });

  it("declares Wan size constraints and resolution options", () => {
    expect(wanAdapter.sizeConstraints).toEqual({
      step: 1,
      min: 768,
      max: Math.floor((2048 * 2048) / 768),
      maxPixels: 4194304,
      minPixels: 589824,
      maxAspectRatio: 8,
      defaultSize: "2048x2048",
    });
    expect(wanAdapter.resolutionOptions.map((option) => option.value)).toEqual([
      "1k",
      "2k",
    ]);
  });

  it("declares 4K text-to-image metadata for wan2.7-image-pro", () => {
    expect(wanAdapter.getSizeConstraints?.(PRO_CONFIG)).toMatchObject({
      maxPixels: 4096 * 4096,
      minPixels: 768 * 768,
      maxAspectRatio: 8,
    });
    expect(wanAdapter.getResolutionOptions?.(PRO_CONFIG).map((option) => option.value)).toEqual([
      "1k",
      "2k",
      "4k",
    ]);
  });
});
