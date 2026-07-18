import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGrokEditBody,
  buildGrokGenerateBody,
  grokAdapter,
  normalizeGrokBaseUrl,
} from "../adapters/grok.js";
import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  ProviderConfig,
} from "../types.js";

const CONFIG: ProviderConfig = {
  provider: "grok",
  apiBaseUrl: "https://api.x.ai/v1/images",
  apiKey: "xai-test",
  model: "grok-imagine-image",
};

function baseGenerateRequest(
  overrides: Partial<OpenAIImageRequest> = {},
): OpenAIImageRequest {
  return {
    model: "grok-imagine-image",
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
    model: "grok-imagine-image",
    prompt: "改一下图",
    size: "1:1",
    resolution: "1k",
    background: "auto",
    outputFormat: "png",
    extra: {},
    images: [
      {
        blob: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        name: "ref.png",
        mimeType: "image/png",
      },
    ],
    editExtra: {},
    ...overrides,
  };
}

describe("normalizeGrokBaseUrl", () => {
  it("appends /v1/images when no version segment", () => {
    expect(normalizeGrokBaseUrl("https://api.x.ai")).toBe(
      "https://api.x.ai/v1/images",
    );
  });

  it("appends /images when /v1 present", () => {
    expect(normalizeGrokBaseUrl("https://api.x.ai/v1")).toBe(
      "https://api.x.ai/v1/images",
    );
  });

  it("keeps as-is when /v1/images already present", () => {
    expect(normalizeGrokBaseUrl("https://api.x.ai/v1/images")).toBe(
      "https://api.x.ai/v1/images",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeGrokBaseUrl("https://api.x.ai/v1/images/")).toBe(
      "https://api.x.ai/v1/images",
    );
  });
});

describe("buildGrokGenerateBody", () => {
  it("includes model, prompt, response_format, aspect_ratio, resolution", () => {
    const body = buildGrokGenerateBody(
      baseGenerateRequest(),
      "grok-imagine-image",
    );
    expect(body).toEqual({
      model: "grok-imagine-image",
      prompt: "画一张图",
      response_format: "b64_json",
      aspect_ratio: "16:9",
      resolution: "2k",
    });
  });

  it("omits aspect_ratio for WxH size", () => {
    const body = buildGrokGenerateBody(
      baseGenerateRequest({ size: "1024x1024" }),
      "grok-imagine-image",
    );
    expect(body.aspect_ratio).toBeUndefined();
  });

  it("omits aspect_ratio for auto size", () => {
    const body = buildGrokGenerateBody(
      baseGenerateRequest({ size: "auto" }),
      "grok-imagine-image",
    );
    expect(body.aspect_ratio).toBeUndefined();
  });

  it("omits aspect_ratio for unsupported ratio", () => {
    // 21:9 是 Gemini 支持但 Grok 不支持的
    const body = buildGrokGenerateBody(
      baseGenerateRequest({ size: "21:9" }),
      "grok-imagine-image",
    );
    expect(body.aspect_ratio).toBeUndefined();
  });

  it("omits resolution when request.resolution is missing or unsupported", () => {
    const bodyNoRes = buildGrokGenerateBody(
      baseGenerateRequest({ resolution: undefined }),
      "grok-imagine-image",
    );
    expect(bodyNoRes.resolution).toBeUndefined();

    const bodyBadRes = buildGrokGenerateBody(
      baseGenerateRequest({ resolution: "4k" }),
      "grok-imagine-image",
    );
    expect(bodyBadRes.resolution).toBeUndefined();
  });

  it("strips background/output_format/extra except resolution", () => {
    const body = buildGrokGenerateBody(
      baseGenerateRequest({
        background: "transparent",
        resolution: "1k",
        extra: { quality: "high" },
      }),
      "grok-imagine-image",
    );
    expect(body.background).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(body.quality).toBeUndefined();
    expect(body.resolution).toBe("1k");
  });
});

describe("buildGrokEditBody", () => {
  it("uses image field for single image", () => {
    const body = buildGrokEditBody(baseEditRequest(), "grok-imagine-image");
    expect(body.image).toEqual({
      type: "image_url",
      url: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(body.images).toBeUndefined();
  });

  it("uses images field for multiple images", () => {
    const request = baseEditRequest({
      images: [
        {
          blob: Buffer.from([0x89, 0x50]),
          name: "a.png",
          mimeType: "image/png",
        },
        {
          blob: Buffer.from([0xff, 0xd8]),
          name: "b.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });
    const body = buildGrokEditBody(request, "grok-imagine-image");
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images).toHaveLength(2);
    expect(body.image).toBeUndefined();
  });

  it("image url is base64 data URL without prefix in b64", () => {
    const request = baseEditRequest({
      images: [
        {
          blob: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          name: "ref.png",
          mimeType: "image/png",
        },
      ],
    });
    const body = buildGrokEditBody(request, "grok-imagine-image");
    const url = (body.image as { url: string }).url;
    // data URL 形状：data:image/png;base64,<base64>
    expect(url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });
});

describe("grokAdapter.generate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /generations with Bearer auth and parses b64_json", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { b64_json: "Z3Jvay1pbWFnZQ==", revised_prompt: "grok rewrite" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await grokAdapter.generate(baseGenerateRequest(), CONFIG);

    expect(result.b64Json).toBe("Z3Jvay1pbWFnZQ==");
    expect(result.revisedPrompt).toBe("grok rewrite");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/images/generations");
    expect(init.headers).toEqual({
      Authorization: "Bearer xai-test",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "grok-imagine-image",
      prompt: "画一张图",
      response_format: "b64_json",
      aspect_ratio: "16:9",
      resolution: "2k",
    });
  });

  it("handles /v1 base url without /images suffix", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "WA==" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await grokAdapter.generate(baseGenerateRequest(), {
      ...CONFIG,
      apiBaseUrl: "https://api.x.ai/v1",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.x.ai/v1/images/generations",
    );
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    await expect(
      grokAdapter.generate(baseGenerateRequest(), CONFIG),
    ).rejects.toThrow("服务器主动断开了连接");
  });

  it("throws upstream error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "You have run out of credits." },
            }),
            { status: 403 },
          ),
      ),
    );
    await expect(
      grokAdapter.generate(baseGenerateRequest(), CONFIG),
    ).rejects.toThrow("run out of credits");
  });

  it("throws when response has no b64_json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
      ),
    );
    await expect(
      grokAdapter.generate(baseGenerateRequest(), CONFIG),
    ).rejects.toThrow(/b64_json|Grok/);
  });
});

describe("grokAdapter.edit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /edits with single image field", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdA==" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await grokAdapter.edit(baseEditRequest(), CONFIG);

    expect(result.b64Json).toBe("ZWRpdA==");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/images/edits");
    const body = JSON.parse(String(init.body));
    expect(body.image).toEqual({
      type: "image_url",
      url: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(body.images).toBeUndefined();
    expect(body.response_format).toBe("b64_json");
  });

  it("posts multiple images as images array", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "WA==" }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await grokAdapter.edit(
      baseEditRequest({
        images: [
          { blob: Buffer.from([0x89]), name: "a.png", mimeType: "image/png" },
          { blob: Buffer.from([0xff]), name: "b.jpg", mimeType: "image/jpeg" },
        ],
      }),
      CONFIG,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images).toHaveLength(2);
    expect(body.image).toBeUndefined();
  });

  it("throws when no reference image provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
    await expect(
      grokAdapter.edit(baseEditRequest({ images: [] }), CONFIG),
    ).rejects.toThrow("参考图");
  });

  it("throws upstream disconnect when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNRESET"))),
    );
    await expect(grokAdapter.edit(baseEditRequest(), CONFIG)).rejects.toThrow(
      "服务器主动断开了连接",
    );
  });
});

describe("grokAdapter static metadata", () => {
  it("declares Grok capability (edit=true, mask=false)", () => {
    expect(grokAdapter.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg", "webp"],
    });
  });

  it("declares resolution options [1k, 2k]", () => {
    expect(grokAdapter.resolutionOptions.map((o) => o.value)).toEqual([
      "1k",
      "2k",
    ]);
  });

  it("describe returns model or default", () => {
    expect(grokAdapter.describe(CONFIG).label).toBe("grok-imagine-image");
    expect(grokAdapter.describe({ ...CONFIG, model: undefined }).label).toBe(
      "grok-imagine-image",
    );
  });
});
