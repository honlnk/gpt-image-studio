import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doubaoAdapter, normalizeDoubaoSize } from "../adapters/doubao.js";
import type { ProviderConfig, SizeConstraints } from "../types.js";

const CONSTRAINTS: SizeConstraints = {
  step: 1,
  min: 512,
  max: 4096,
  maxPixels: 16777216,
  minPixels: 3686400,
  maxAspectRatio: 16,
  defaultSize: "2048x2048",
};

const CONFIG: ProviderConfig = {
  provider: "doubao",
  apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images",
  apiKey: "doubao-test-key",
  model: "doubao-seedream-5-0-lite",
};

describe("normalizeDoubaoSize", () => {
  it("maps auto to default size", () => {
    expect(normalizeDoubaoSize("auto", CONSTRAINTS)).toBe("2048x2048");
  });

  it("maps empty string to default size", () => {
    expect(normalizeDoubaoSize("", CONSTRAINTS)).toBe("2048x2048");
  });

  it("passes through a valid WxH within range", () => {
    expect(normalizeDoubaoSize("2048x2048", CONSTRAINTS)).toBe("2048x2048");
    expect(normalizeDoubaoSize("3840x2160", CONSTRAINTS)).toBe("3840x2160");
  });

  it("does NOT align to step (step=1, accepts any integer)", () => {
    // 豆包无步长对齐：2345x1234 原样保留（只要在像素范围内）
    expect(normalizeDoubaoSize("2345x2345", CONSTRAINTS)).toBe("2345x2345");
  });

  it("scales up when pixels below minPixels", () => {
    // 1280x1280 = 1638400 < minPixels 3686400，应放大长边
    const result = normalizeDoubaoSize("1280x1280", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(w * h).toBeGreaterThanOrEqual(CONSTRAINTS.minPixels);
  });

  it("scales down when pixels above maxPixels", () => {
    // 6000x6000 = 36000000 > maxPixels 16777216，应缩小
    const result = normalizeDoubaoSize("6000x6000", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(w * h).toBeLessThanOrEqual(CONSTRAINTS.maxPixels);
  });

  it("clamps aspect ratio above maxAspectRatio (16)", () => {
    // 100:1 比例远超 16:1，宽边应被钳到 16 倍短边
    const result = normalizeDoubaoSize("6400x64", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(w / h).toBeLessThanOrEqual(16 + 0.01); // 允许舍入误差
  });

  it("clamps aspect ratio below 1/maxAspectRatio (1/16)", () => {
    // 1:100 比例，高边应被钳到 16 倍宽边
    const result = normalizeDoubaoSize("64x6400", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(h / w).toBeLessThanOrEqual(16 + 0.01);
  });

  it("handles ratio format (16:9)", () => {
    const result = normalizeDoubaoSize("16:9", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(w).toBeGreaterThan(h);
    expect(w * h).toBeGreaterThanOrEqual(CONSTRAINTS.minPixels);
    expect(w * h).toBeLessThanOrEqual(CONSTRAINTS.maxPixels);
  });

  it("handles ratio format (9:16 portrait)", () => {
    const result = normalizeDoubaoSize("9:16", CONSTRAINTS);
    const [w, h] = result.split("x").map(Number);
    expect(h).toBeGreaterThan(w);
  });

  it("accepts unicode × separator", () => {
    expect(normalizeDoubaoSize("2048×2048", CONSTRAINTS)).toBe("2048x2048");
  });

  it("falls back to default for unrecognizable size", () => {
    expect(normalizeDoubaoSize("bogus", CONSTRAINTS)).toBe("2048x2048");
  });

  it("output always uses lowercase x separator", () => {
    const result = normalizeDoubaoSize("16:9", CONSTRAINTS);
    expect(result).toMatch(/^\d+x\d+$/);
  });
});

describe("doubaoAdapter.generate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends b64_json response_format and watermark=false, strips background/output_format/extra", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: [{ b64_json: "ZGF0YQ==" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await doubaoAdapter.generate(
      {
        model: "doubao-seedream-5-0-lite",
        prompt: "a cat",
        size: "2048x2048",
        background: "opaque",
        outputFormat: "png",
        extra: { quality: "high" }, // extra 应被裁掉
      },
      CONFIG,
    );

    expect(result.b64Json).toBe("ZGF0YQ==");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    const body = JSON.parse(String(init.body));
    // D2: 固定 response_format=b64_json
    expect(body.response_format).toBe("b64_json");
    // D3: 固定 watermark=false
    expect(body.watermark).toBe(false);
    // 豆包只认 model/prompt/size，background/output_format/extra 应被裁掉
    expect(body).toEqual({
      model: "doubao-seedream-5-0-lite",
      prompt: "a cat",
      size: "2048x2048",
      response_format: "b64_json",
      watermark: false,
    });
    expect(body.background).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });

  it("normalizes size=auto to default 2048x2048", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: [{ b64_json: "ZGF0YQ==" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await doubaoAdapter.generate(
      {
        model: "doubao-seedream-5-0-lite",
        prompt: "a cat",
        size: "auto",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.size).toBe("2048x2048");
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    await expect(
      doubaoAdapter.generate(
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
    ).rejects.toThrow("服务器主动断开了连接");
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
      doubaoAdapter.generate(
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
    ).rejects.toThrow("prompt 违规");
  });

  it("throws when response has no b64_json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
      ),
    );
    await expect(
      doubaoAdapter.generate(
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
    ).rejects.toThrow(/data\[0\]\.b64_json|没有/);
  });

  it("does NOT call urlToB64 (takes b64_json directly)", async () => {
    // 豆包 generate 只应发一次 fetch（generations 请求），不应再 fetch URL 下载图片。
    // 若错误地走了 urlToB64，fetch 会被调用第二次。
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: [{ b64_json: "ZGF0YQ==" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await doubaoAdapter.generate(
      {
        model: "x",
        prompt: "x",
        size: "auto",
        background: "auto",
        outputFormat: "png",
        extra: {},
      },
      CONFIG,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // D2: 只一次，不经 URL 下载
  });
});

describe("doubaoAdapter.edit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /generations with image data URL, response_format, watermark=false", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ data: [{ b64_json: "ZWRpdA==" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const imageBlob = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await doubaoAdapter.edit(
      {
        model: "doubao-seedream-5-0-260128",
        prompt: "把背景换成蓝天",
        size: "2048x2048",
        background: "auto",
        outputFormat: "png",
        extra: {},
        images: [{ blob: imageBlob, name: "ref.png", mimeType: "image/png" }],
        editExtra: {},
      },
      { ...CONFIG, model: "doubao-seedream-5-0-260128" },
    );

    expect(result.b64Json).toBe("ZWRpdA==");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // 豆包图生图不分独立 edits 端点，参考图塞进 /generations 的 image 字段
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("doubao-seedream-5-0-260128");
    expect(body.prompt).toBe("把背景换成蓝天");
    expect(body.size).toBe("2048x2048");
    expect(body.response_format).toBe("b64_json");
    expect(body.watermark).toBe(false);
    // image 字段是 base64 data URL
    expect(body.image).toBe(`data:image/png;base64,${imageBlob.toString("base64")}`);
    // 不应含 background/output_format（豆包不认）/ mask（不支持）
    expect(body.background).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(body.mask).toBeUndefined();
  });

  it("throws when no reference image provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response()));

    await expect(
      doubaoAdapter.edit(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images: [], // 无参考图
          editExtra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("参考图");
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    await expect(
      doubaoAdapter.edit(
        {
          model: "x",
          prompt: "x",
          size: "auto",
          background: "auto",
          outputFormat: "png",
          extra: {},
          images: [{ blob: Buffer.from([0x00]), name: "r.png", mimeType: "image/png" }],
          editExtra: {},
        },
        CONFIG,
      ),
    ).rejects.toThrow("服务器主动断开了连接");
  });
});

describe("doubaoAdapter static metadata", () => {
  it("declares Doubao capability (edit=true, mask=false)", () => {
    expect(doubaoAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg"],
    });
  });

  it("declares Doubao size constraints (step=1, minPixels=3686400)", () => {
    expect(doubaoAdapter.sizeConstraints).toEqual({
      step: 1,
      min: 512,
      max: 4096,
      maxPixels: 16777216,
      minPixels: 3686400,
      maxAspectRatio: 16,
      defaultSize: "2048x2048",
    });
  });

  it("declares resolution options [2k, 3k, 4k] (no 1k, has native 3k)", () => {
    expect(doubaoAdapter.resolutionOptions.map((o) => o.value)).toEqual([
      "2k",
      "3k",
      "4k",
    ]);
    // 不含 1k（豆包 minPixels 达不到）
    expect(doubaoAdapter.resolutionOptions.find((o) => o.value === "1k")).toBeUndefined();
  });
});
