import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createSecurityConfig } from "../securityConfig.js";
import type { ProviderConfig } from "../providers/types.js";

/**
 * route 级集成测试：Fastify injection 模拟真实 HTTP，mock 上游 fetch。
 * 不起真实端口、不依赖配对（这里只注册 images 路由，跳过 auth 中间件）。
 *
 * 通过 vi.doMock 控制 credentials（避免触碰真实文件系统）。
 */

function makeApp(): FastifyInstance {
  const app = Fastify();
  app.register(imagesRoutes, { security: createSecurityConfig({ channel: "dev" }) });
  return app;
}

// 动态 import，让 doMock 生效
let imagesRoutes: typeof import("./images.js").imagesRoutes;

beforeEach(async () => {
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.doUnmock("../credentials.js");
});

/**
 * mock getActiveCredential：返回 CredentialEntry 形状或 null。
 * toProviderConfig 只消费 provider/apiBaseUrl/apiKey/model，所以测试给最小字段即可。
 */
async function setupWithCredentials(creds: {
  apiBaseUrl: string;
  apiKey: string;
  provider?: string;
  model?: string;
} | null) {
  vi.doMock("../credentials.js", () => ({
    getActiveCredential: () => creds,
  }));
  const mod = await import("./images.js");
  imagesRoutes = mod.imagesRoutes;
  return makeApp();
}

function makeWebEditMultipart(fields: Record<string, string>): {
  boundary: string;
  body: Buffer;
} {
  const boundary = "----web-resolution-boundary";
  const crlf = "\r\n";
  const parts = Object.entries(fields).map(([name, value]) =>
    `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`
  );
  parts.push(
    `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="ref.png"${crlf}Content-Type: image/png${crlf}${crlf}PNG${crlf}`,
  );
  parts.push(`--${boundary}--${crlf}`);
  return { boundary, body: Buffer.from(parts.join(""), "utf8") };
}

describe("images routes integration — generate", () => {
  it("returns b64_json from upstream on happy path", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("https://up.example.com/v1/images/generations");
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
          model: "gpt-image-2",
          prompt: "a cat",
          quality: "high", // extra 字段必须透传
        });
        expect(body.companion_resolution).toBeUndefined();
        expect(body.resolution).toBeUndefined();
        return new Response(
          JSON.stringify({ data: [{ b64_json: "QUJD", revised_prompt: "rp" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-image-2",
        prompt: "a cat",
        size: "1024x1024",
        companion_resolution: "1k",
        quality: "high",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [{ b64_json: "QUJD", revised_prompt: "rp", mime_type: undefined }],
    });
    await app.close();
  });

  it("returns 503 when no credentials", async () => {
    const app = await setupWithCredentials(null);
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "x" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("未配置凭据");
    await app.close();
  });

  it("forwards upstream error message with 502", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "content policy" } }), {
          status: 400,
        }),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "x" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("content policy");
    await app.close();
  });

  it("classifies ECONNRESET as reset category with 502", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(networkError)));
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "x" },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.category).toBe("reset");
    // reset 文案保留了"可能是审核"的猜测，但局限到这一类
    expect(body.error).toContain("断开了连接");
    await app.close();
  });

  it("rejects non-json content-type", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "text/plain" },
      payload: "hello",
    });
    expect(res.statusCode).toBe(415);
    await app.close();
  });

  it("rejects body missing prompt", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("缺少 prompt");
    await app.close();
  });
});

describe("images routes integration — resolution contract", () => {
  it("normalizes Grok generation companion_resolution", async () => {
    const app = await setupWithCredentials({
      provider: "grok",
      apiBaseUrl: "https://api.x.ai/v1/images",
      apiKey: "xai-test",
      model: "grok-imagine-image",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.resolution).toBe("2k");
        expect(body.companion_resolution).toBeUndefined();
        return new Response(JSON.stringify({ data: [{ b64_json: "R1JPSw==" }] }), {
          status: 200,
        });
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "grok-imagine-image",
        prompt: "a cat",
        size: "2048x2048",
        companion_resolution: "2k",
      },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("normalizes Grok edit companion_resolution", async () => {
    const app = await setupWithCredentials({
      provider: "grok",
      apiBaseUrl: "https://api.x.ai/v1/images",
      apiKey: "xai-test",
      model: "grok-imagine-image",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.resolution).toBe("1k");
        expect(body.companion_resolution).toBeUndefined();
        return new Response(JSON.stringify({ data: [{ b64_json: "R1JPSw==" }] }), {
          status: 200,
        });
      }),
    );
    const multipart = makeWebEditMultipart({
      model: "grok-imagine-image",
      prompt: "edit it",
      size: "1024x1024",
      companion_resolution: "1k",
    });

    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: {
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
      },
      payload: multipart.body,
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("normalizes Gemini generation companion_resolution", async () => {
    const app = await setupWithCredentials({
      provider: "gemini",
      apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-test",
      model: "gemini-2.5-flash-image",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.generationConfig.responseFormat.image.imageSize).toBe("4K");
        expect(JSON.stringify(body)).not.toContain("companion_resolution");
        return new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{ inlineData: { data: "R0VNSU5J", mimeType: "image/png" } }],
              },
            }],
          }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gemini-2.5-flash-image",
        prompt: "a cat",
        size: "4096x4096",
        companion_resolution: "4k",
      },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("normalizes Gemini edit companion_resolution", async () => {
    const app = await setupWithCredentials({
      provider: "gemini",
      apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-test",
      model: "gemini-2.5-flash-image",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.generationConfig.responseFormat.image.imageSize).toBe("2K");
        expect(JSON.stringify(body)).not.toContain("companion_resolution");
        return new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{ inlineData: { data: "R0VNSU5J", mimeType: "image/png" } }],
              },
            }],
          }),
          { status: 200 },
        );
      }),
    );
    const multipart = makeWebEditMultipart({
      model: "gemini-2.5-flash-image",
      prompt: "edit it",
      size: "2048x2048",
      companion_resolution: "2k",
    });

    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: {
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
      },
      payload: multipart.body,
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("images routes integration — edit", () => {
  it("forwards multipart image[], mask, and extra fields to upstream", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    const seen: { url: string; contentType: string; body: Buffer }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url,
          contentType: (init.headers as Record<string, string>)["Content-Type"],
          body: Buffer.from(init.body as Uint8Array),
        });
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    // 构造 web 风格的 multipart
    const boundary = "----web-boundary";
    const crlf = "\r\n";
    const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const maskBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    const parts = [
      `--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}gpt-image-2${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="prompt"${crlf}${crlf}edit it${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="quality"${crlf}${crlf}high${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="stream"${crlf}${crlf}true${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="a.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="mask"; filename="m.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
      `--${boundary}--${crlf}`,
    ];
    const bodyBuf = Buffer.concat([
      Buffer.from(parts[0] + parts[1] + parts[2] + parts[3] + parts[4], "utf8"),
      imgBytes,
      Buffer.from(crlf + parts[5], "utf8"),
      maskBytes,
      Buffer.from(crlf + parts[6], "utf8"),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: bodyBuf,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ b64_json: "UVdY", revised_prompt: undefined, mime_type: undefined }] });

    // 上游收到的应是合法 multipart，含 image[] + mask + 文本字段
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://up.example.com/v1/images/edits");
    const upstreamText = seen[0].body.toString("latin1");
    expect(upstreamText).toContain('name="model"');
    expect(upstreamText).toContain('name="prompt"');
    expect(upstreamText).toContain('name="quality"'); // extra 透传
    expect(upstreamText).toContain('name="stream"');
    expect(upstreamText).toContain('name="image[]"');
    expect(upstreamText).toContain('name="mask"');
    await app.close();
  });

  it("rejects mask-less validation error", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    // 没有 image[] part
    const boundary = "----b";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-2\r\n--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("至少需要一张引用图片");
    await app.close();
  });
});

/**
 * Provider 专属参考图数量上限（豆包 editConstraints.maxImages = 10）。
 * 校验落在 route 层，返回 400（而非 adapter 内部 throw 变 502）。
 */
describe("images routes integration — provider edit image limit", () => {
  /**
   * 构造带 N 张 image[] 的 doubao 编辑请求。
   * doubao 走 image_field 模式（/generations + JSON image 字段），
   * 1 张传单值、≥2 张传数组——这里验证数组形状和多图不再被静默丢弃。
   */
  function makeDoubaoEditBody(imageCount: number): { boundary: string; body: Buffer } {
    const boundary = "----doubao-boundary";
    const crlf = "\r\n";
    const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const textParts = [
      `--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}doubao-seedream-5-0-pro-250528${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="prompt"${crlf}${crlf}edit it${crlf}`,
    ];
    const chunks: Buffer[] = [
      Buffer.from(textParts.join(""), "utf8"),
    ];
    for (let i = 0; i < imageCount; i++) {
      chunks.push(
        Buffer.from(
          `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="img${i}.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
          "utf8",
        ),
        imgBytes,
        Buffer.from(crlf, "utf8"),
      );
    }
    chunks.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));
    return { boundary, body: Buffer.concat(chunks) };
  }

  it("rejects doubao edit with 11 images (exceeds maxImages=10)", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://ark.example.com/api/v3/images",
      apiKey: "sk-doubao",
      provider: "doubao",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { boundary, body } = makeDoubaoEditBody(11);
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("最多支持 10 张参考图");
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("sends image[] array to doubao upstream when ≥2 images", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://ark.example.com/api/v3/images",
      apiKey: "sk-doubao",
      provider: "doubao",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeDoubaoEditBody(2);
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // ≥2 张 → image 字段应为数组
    expect(Array.isArray(seen[0].image)).toBe(true);
    expect((seen[0].image as unknown[]).length).toBe(2);
    await app.close();
  });

  it("sends single image value (not array) to doubao upstream when 1 image", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://ark.example.com/api/v3/images",
      apiKey: "sk-doubao",
      provider: "doubao",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeDoubaoEditBody(1);
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // 1 张 → image 字段应为 string（data URL），向后兼容
    expect(typeof seen[0].image).toBe("string");
    await app.close();
  });
});

/**
 * Provider 专属单张参考图大小上限（editConstraints.maxImageBytes）。
 * 校验落在 route 层，返回 400（而非等上游拒绝变 502）。
 */
describe("images routes integration — provider edit image size limit", () => {
  /** 构造带单张大体积 image[] 的编辑请求。 */
  function makeOversizedEditBody(imageBytes: Buffer): { boundary: string; body: Buffer } {
    const boundary = "----size-boundary";
    const crlf = "\r\n";
    const textParts = [
      `--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}test-model${crlf}`,
      `--${boundary}${crlf}Content-Disposition: form-data; name="prompt"${crlf}${crlf}edit it${crlf}`,
    ];
    const body = Buffer.concat([
      Buffer.from(textParts.join(""), "utf8"),
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="big.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
        "utf8",
      ),
      imageBytes,
      Buffer.from(crlf + `--${boundary}--${crlf}`, "utf8"),
    ]);
    return { boundary, body };
  }

  it("rejects qwen edit with oversized single image (>10MB)", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://dashscope.example.com",
      apiKey: "sk-qwen",
      provider: "qwen",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // 11 MB > qwen 的 10MB 上限
    const bigImage = Buffer.alloc(11 * 1024 * 1024, 0x89);
    const { boundary, body } = makeOversizedEditBody(bigImage);
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("单张参考图大小超过当前 provider 上限 10MB");
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * 已知字段契约（review P1 第 5 项）：每个 COMPANION_GENERATE_FIELDS 里声明的字段，
 * 从 Web 真实请求形状出发，经过 route → OpenAI adapter 后，必须出现在上游请求的正确位置。
 *
 * 防的是「字段名漂移导致静默失效」：如果 Web 加了字段、Companion 的 KNOWN 清单漏同步，
 * 该字段会被 route 当作 unknown 塞进 extra，结果要么被 OpenAI adapter 重复展开，
 * 要么根本到不了 provider。本测试用 it.each 强制覆盖每一个已知字段。
 */
describe("images routes integration — known fields contract", () => {
  /**
   * 对每个已知字段：发 OpenAI happy-path 请求，断言上游收到的 body 里
   * 该字段的值正确出现在 OpenAI 标准位置（而非原始 companion_xxx 形态或 extra 透传）。
   *
   * 注意 `companion_resolution` 的特殊性：OpenAI adapter 不向上游发 resolution，
   * 所以这条断言的是"它被 route 识别为已知字段、翻译成 request.resolution"
   * （即没有原样作为 companion_resolution 落入 extra 又透传到上游）。
   */
  const generateCases: Array<[string, string, (body: Record<string, unknown>) => void]> = [
    ["model", "gpt-image-2", (b) => expect(b.model).toBe("gpt-image-2")],
    ["prompt", "a cat", (b) => expect(b.prompt).toBe("a cat")],
    // 用非默认值：route 漏提取 size 时会用 "1024x1024" 默认值，断言会失败
    ["size", "1536x1024", (b) => expect(b.size).toBe("1536x1024")],
    [
      "companion_resolution",
      "1k",
      (b) => {
        // OpenAI adapter 不向上游发 resolution，但 companion_resolution 也不能
        // 作为 unknown 字段透传——那说明 route 没识别它，会导致 resolution 能力静默失效。
        expect(b.companion_resolution).toBeUndefined();
        expect(b.resolution).toBeUndefined();
      },
    ],
    ["background", "transparent", (b) => expect(b.background).toBe("transparent")],
    ["output_format", "webp", (b) => expect(b.output_format).toBe("webp")],
  ];

  it.each(generateCases)(
    "generate: known field %s flows from web shape to OpenAI upstream",
    async (_label, value, assert) => {
      const app = await setupWithCredentials({
        apiBaseUrl: "https://up.example.com/v1/images",
        apiKey: "sk-test",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          assert(body);
          return new Response(
            JSON.stringify({ data: [{ b64_json: "QUJD" }] }),
            { status: 200 },
          );
        }),
      );

      const res = await app.inject({
        method: "POST",
        url: "/images/generations",
        headers: { "content-type": "application/json" },
        payload: {
          model: "gpt-image-2",
          prompt: "a cat",
          size: "1536x1024",
          companion_resolution: "1k",
          background: "transparent",
          output_format: "webp",
        },
      });

      expect(res.statusCode).toBe(200);
      await app.close();
    },
  );

  /**
   * 编辑路径同理：已知字段经 multipart → route → OpenAI adapter 后必须正确到达上游。
   *
   * OpenAI edit adapter 把字段重新打包成 multipart 发到上游。本测试对每个已知字段
   * 断言「它在上游 multipart body 里以正确的字段名出现」——如果 route 把某字段
   * 误判为 unknown 塞进 editExtra，OpenAI adapter 会原样透传该 key（包括
   * companion_resolution 这种本应被翻译的字段），从而暴露字段名漂移。
   */
  const editCases: Array<[string, string, (upstreamText: string) => void]> = [
    ["model", "gpt-image-2", (t) => expect(t).toMatch(/name="model"\r\n\r\ngpt-image-2/)],
    ["prompt", "edit it", (t) => expect(t).toMatch(/name="prompt"\r\n\r\nedit it/)],
    // 用非默认值：route 漏提取时会用 "1024x1024" 默认值，断言会失败
    ["size", "1536x1024", (t) => expect(t).toMatch(/name="size"\r\n\r\n1536x1024/)],
    [
      "companion_resolution",
      "1k",
      // companion_resolution 必须被 route 翻译成 request.resolution，不能原样
      // 作为 editExtra 透传——否则字段名漂移会导致 resolution 能力在 edit 路径静默失效。
      (t) => expect(t).not.toContain("companion_resolution"),
    ],
    ["background", "opaque", (t) => expect(t).toMatch(/name="background"\r\n\r\nopaque/)],
    // 用非默认值 webp：route 漏提取时会用 "png" 默认值，断言会失败
    ["output_format", "webp", (t) => expect(t).toMatch(/name="output_format"\r\n\r\nwebp/)],
  ];

  it.each(editCases)(
    "edit: known field %s flows from web multipart to OpenAI upstream",
    async (_label, _value, assert) => {
      const app = await setupWithCredentials({
        apiBaseUrl: "https://up.example.com/v1/images",
        apiKey: "sk-test",
      });
      let upstreamText = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          upstreamText = Buffer.from(init.body as Uint8Array).toString("latin1");
          return new Response(JSON.stringify({ data: [{ b64_json: "QUJD" }] }), {
            status: 200,
          });
        }),
      );

      const multipart = makeWebEditMultipart({
        model: "gpt-image-2",
        prompt: "edit it",
        size: "1536x1024",
        companion_resolution: "1k",
        background: "opaque",
        output_format: "webp",
      });

      const res = await app.inject({
        method: "POST",
        url: "/images/edits",
        headers: {
          "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
        },
        payload: multipart.body,
      });

      expect(res.statusCode).toBe(200);
      assert(upstreamText);
      await app.close();
    },
  );
});

describe("provider config passthrough", () => {
  it("defaults to openai when provider field is absent (toProviderConfig fallback)", async () => {
    // toProviderConfig 对缺省 provider 回退 openai；CredentialEntry.provider 恒有值，
    // 但该回退是防御性代码，保留测试以防误删。
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
      // 故意不传 provider，验证回退逻辑
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "QUJD" }] }), { status: 200 }),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "x" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

/**
 * 错误分类端到端契约（review P2 第 4 项）：route 层必须按 errno / HTTP 状态把异常
 * 翻译成 category 字段回传给 Web，让前端能做差异化处理（如 dns 引导检查 apiBaseUrl，
 * rate_limited 自动退避）。本测试用 it.each 覆盖每一类典型场景。
 *
 * 与 providerErrors.test.ts（单元层）的区别：本测试走完整的 route → adapter → postJson
 * 链路，确认错误从 fetch 抛出到 502 body 之间没有被错误归因。
 */
describe("images routes integration — error classification", () => {
  /**
   * 网络层分类：模拟 Node fetch 在不同 errno 下抛错，验证 502 body 的 category 正确。
   */
  const networkCases: Array<{
    label: string;
    error: unknown;
    expectedCategory: string;
  }> = [
    {
      label: "ENOTFOUND → dns",
      error: Object.assign(new Error("getaddrinfo ENOTFOUND up.example.com"), {
        code: "ENOTFOUND",
      }),
      expectedCategory: "dns",
    },
    {
      label: "ECONNREFUSED → refused",
      error: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
      expectedCategory: "refused",
    },
    {
      label: "AbortError → aborted",
      error: new DOMException("aborted", "AbortError"),
      expectedCategory: "aborted",
    },
  ];

  it.each(networkCases)(
    "classifies network error: $label",
    async ({ error, expectedCategory }) => {
      const app = await setupWithCredentials({
        apiBaseUrl: "https://up.example.com/v1/images",
        apiKey: "sk-test",
      });
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(error)));
      const res = await app.inject({
        method: "POST",
        url: "/images/generations",
        headers: { "content-type": "application/json" },
        payload: { model: "gpt-image-2", prompt: "x" },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().category).toBe(expectedCategory);
      await app.close();
    },
  );

  /**
   * HTTP 层分类：上游返回非 2xx，route 应按状态码归类 4xx / 429 / 5xx。
   * message 优先取上游 error.message，缺失时用 category 兜底文案。
   */
  const httpCases: Array<{
    label: string;
    status: number;
    body: unknown;
    expectedCategory: string;
    expectedErrorSubstring?: string;
  }> = [
    {
      label: "400 with detail → http_4xx, message from upstream",
      status: 400,
      body: { error: { message: "Invalid size" } },
      expectedCategory: "http_4xx",
      expectedErrorSubstring: "Invalid size",
    },
    {
      label: "401 no detail → http_4xx, fallback message",
      status: 401,
      body: {},
      expectedCategory: "http_4xx",
    },
    {
      label: "429 → rate_limited",
      status: 429,
      body: { error: { message: "Too Many Requests" } },
      expectedCategory: "rate_limited",
      expectedErrorSubstring: "Too Many Requests",
    },
    {
      label: "500 → http_5xx, fallback message",
      status: 500,
      body: {},
      expectedCategory: "http_5xx",
    },
    {
      label: "503 with detail → http_5xx, message from upstream",
      status: 503,
      body: { error: { message: "Maintenance" } },
      expectedCategory: "http_5xx",
      expectedErrorSubstring: "Maintenance",
    },
  ];

  it.each(httpCases)(
    "classifies HTTP: $label",
    async ({ status, body, expectedCategory, expectedErrorSubstring }) => {
      const app = await setupWithCredentials({
        apiBaseUrl: "https://up.example.com/v1/images",
        apiKey: "sk-test",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify(body), { status }),
        ),
      );
      const res = await app.inject({
        method: "POST",
        url: "/images/generations",
        headers: { "content-type": "application/json" },
        payload: { model: "gpt-image-2", prompt: "x" },
      });
      expect(res.statusCode).toBe(502);
      const responseBody = res.json();
      expect(responseBody.category).toBe(expectedCategory);
      if (expectedErrorSubstring) {
        expect(responseBody.error).toContain(expectedErrorSubstring);
      }
      await app.close();
    },
  );

  it("does not add category on route-layer validation errors (400)", async () => {
    // route 的早期校验（缺 prompt 等）不走 adapter，错误不带 category。
    // 验证响应 shape 与向后兼容：category 只在 502 出现。
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2" }, // 缺 prompt
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("缺少 prompt");
    expect(body.category).toBeUndefined();
    await app.close();
  });
});

describe("images routes integration — unknown provider returns 503", () => {
  it("generate returns 503 when credential has unknown provider id", async () => {
    // 模拟「凭据文件被外部改坏成拼写错的 provider」或「老版 companion 写入时未校验」
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
      provider: "opneai", // typo
    });
    // fetch 不应该被调用——resolveAdapter 返 null 后 route 直接 503
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "a cat", size: "1024x1024" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toContain("opneai");
    expect(body.error).toMatch(/未注册/);
    expect(body.error).toMatch(/已注册的有/);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("edit returns 503 when credential has unknown provider id", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
      provider: "fake-provider",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const multipart = makeWebEditMultipart({
      model: "gpt-image-2",
      prompt: "edit this",
      size: "1024x1024",
    });

    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${multipart.boundary}` },
      payload: multipart.body,
    });
    expect(res.statusCode).toBe(503);
    const responseBody = res.json();
    expect(responseBody.error).toContain("fake-provider");
    expect(responseBody.error).toMatch(/未注册/);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * 各 Provider 的 generate happy-path 端到端测试。
 *
 * 防的是「route → adapter 接线断裂」：已有 adapter 单元测试覆盖 adapter 内部翻译，
 * 已有 OpenAI 集成测试覆盖 route 提取，但 doubao/glm/qwen/wan/deepinfra 的
 * 「Web 真实请求 → route 提取 → adapter 翻译 → 上游请求体」完整链路此前无覆盖。
 * 这里只验证字段翻译的主体形状（不重复 adapter 单元测试的 exhaustive 字段断言）。
 */
describe("images routes integration — provider generate happy path", () => {
  /**
   * 带 urlToB64 mock 的 setup：GLM/Qwen/Wan 返回图片 URL 后需要下载，
   * 集成测试不起真实网络，mock 成带 magic bytes 的 PNG b64。
   */
  async function setupWithUrlDownload(creds: {
    apiBaseUrl: string;
    apiKey: string;
    provider?: string;
    model?: string;
  }) {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    vi.doMock("../providers/urlToB64.js", () => ({
      urlToB64: vi.fn().mockResolvedValue({ b64Json: pngB64, mimeType: "image/png" }),
    }));
    return setupWithCredentials(creds);
  }

  afterEach(() => {
    vi.doUnmock("../providers/urlToB64.js");
  });

  it("doubao: strict mode strips extra, sends model/prompt/size + requiredFields", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://ark.example.com/api/v3/images",
      apiKey: "sk-doubao",
      provider: "doubao",
      model: "doubao-seedream-5-0-pro-250528",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "doubao-seedream-5-0-pro-250528",
        prompt: "一只猫",
        size: "2048x2048",
        companion_resolution: "2k",
        background: "auto",
        quality: "high",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // strict 模式：只发 model/prompt/size + requiredFields，裁掉 background/output_format/extra
    expect(seen[0]).toMatchObject({
      model: "doubao-seedream-5-0-pro-250528",
      prompt: "一只猫",
      size: "2048x2048",
      response_format: "b64_json",
      watermark: false,
    });
    expect(seen[0].background).toBeUndefined();
    expect(seen[0].quality).toBeUndefined();
    await app.close();
  });

  it("glm: strict mode, fetches url → b64 via urlToB64", async () => {
    const app = await setupWithUrlDownload({
      apiBaseUrl: "https://glm.example.com/api/paas/v4/images",
      apiKey: "sk-glm",
      provider: "glm",
      model: "glm-image",
    });
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, body: JSON.parse(init.body as string) });
        return new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example.com/img.png" }] }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "glm-image",
        prompt: "一只猫",
        size: "1024x1024",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen[0].url).toBe("https://glm.example.com/api/paas/v4/images/generations");
    // strict：只有 model/prompt/size
    expect(seen[0].body).toEqual({
      model: "glm-image",
      prompt: "一只猫",
      size: "1024x1024",
    });
    await app.close();
  });

  it("qwen: DashScope multimodal shape with star-separated size", async () => {
    const app = await setupWithUrlDownload({
      apiBaseUrl: "https://dashscope.example.com/api/v1/services/aigc/multimodal-generation",
      apiKey: "sk-qwen",
      provider: "qwen",
      model: "qwen-image-2.0-pro",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: "https://cdn.example.com/q.png" }] } }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "qwen-image-2.0-pro",
        prompt: "一块写着中文的牌子",
        size: "2048x2048",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      model: "qwen-image-2.0-pro",
      input: {
        messages: [{ role: "user", content: [{ text: "一块写着中文的牌子" }] }],
      },
      parameters: { size: "2048*2048" },
    });
    await app.close();
  });

  it("wan: DashScope with n/watermark/thinking_mode params", async () => {
    const app = await setupWithUrlDownload({
      apiBaseUrl: "https://dashscope.example.com/api/v1/services/aigc/multimodal-generation",
      apiKey: "sk-wan",
      provider: "wan",
      model: "wan2.7-image",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: "https://cdn.example.com/w.png" }] } }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "wan2.7-image",
        prompt: "一张电影感城市夜景",
        size: "2048x2048",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    const params = seen[0].parameters as Record<string, unknown>;
    expect(seen[0].model).toBe("wan2.7-image");
    expect(params.size).toBe("2048*2048");
    expect(params.n).toBe(1);
    expect(params.watermark).toBe(false);
    await app.close();
  });

  it("deepinfra: passthrough mode sends all fields + response_format", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://deepinfra.example.com/v1/openai/images",
      apiKey: "sk-di",
      provider: "deepinfra",
      model: "black-forest-labs/FLUX-1.1-pro",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY", revised_prompt: "rp" }] }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "black-forest-labs/FLUX-1.1-pro",
        prompt: "a cat",
        size: "1024x1024",
        background: "auto",
        output_format: "png",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // passthrough：model/prompt/size/background/output_format + response_format 全在
    expect(seen[0]).toMatchObject({
      model: "black-forest-labs/FLUX-1.1-pro",
      prompt: "a cat",
      background: "auto",
      output_format: "png",
      response_format: "b64_json",
    });
    await app.close();
  });

  it("grok: aspect_ratio + resolution instead of pixel size", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://grok.example.com/v1/images",
      apiKey: "sk-grok",
      provider: "grok",
      model: "grok-imagine-image",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "grok-imagine-image",
        prompt: "画一张图",
        size: "16:9",
        companion_resolution: "2k",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      model: "grok-imagine-image",
      prompt: "画一张图",
      response_format: "b64_json",
      aspect_ratio: "16:9",
      resolution: "2k",
    });
    // 不发 pixel size
    expect(seen[0].size).toBeUndefined();
    await app.close();
  });

  it("gemini: generateContent endpoint with contents/generationConfig shape", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://gemini.example.com",
      apiKey: "sk-gemini",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
    });
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, body: JSON.parse(init.body as string) });
        return new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  inlineData: {
                    mimeType: "image/png",
                    data: "UVdY",
                  },
                }],
              },
            }],
          }),
          { status: 200 },
        );
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gemini-2.5-flash-image",
        prompt: "画一张图",
        size: "16:9",
        companion_resolution: "2k",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // generateContent 端点
    expect(seen[0].url).toContain(":generateContent");
    expect(seen[0].body).toMatchObject({
      contents: [{ parts: [{ text: "画一张图" }] }],
    });
    await app.close();
  });
});

/**
 * 各 Provider 的 edit happy-path 端到端测试。
 * 补此前缺口的 provider：glm 不支持编辑（501），qwen/wan/deepinfra/gemini 此前无 edit 集成测试。
 */
describe("images routes integration — provider edit happy path", () => {
  async function setupWithUrlDownload(creds: {
    apiBaseUrl: string;
    apiKey: string;
    provider?: string;
    model?: string;
  }) {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    vi.doMock("../providers/urlToB64.js", () => ({
      urlToB64: vi.fn().mockResolvedValue({ b64Json: pngB64, mimeType: "image/png" }),
    }));
    return setupWithCredentials(creds);
  }

  afterEach(() => {
    vi.doUnmock("../providers/urlToB64.js");
  });

  /** 构造单图编辑 multipart。 */
  function makeSingleImageEdit(imageBytes: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47])): {
    boundary: string;
    body: Buffer;
  } {
    const boundary = "----edit-boundary";
    const crlf = "\r\n";
    const chunks: Buffer[] = [
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}test-model${crlf}` +
        `--${boundary}${crlf}Content-Disposition: form-data; name="prompt"${crlf}${crlf}edit it${crlf}` +
        `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="ref.png"${crlf}Content-Type: image/png${crlf}${crlf}`,
        "utf8",
      ),
      imageBytes,
      Buffer.from(crlf + `--${boundary}--${crlf}`, "utf8"),
    ];
    return { boundary, body: Buffer.concat(chunks) };
  }

  it("qwen: edit sends image data URL in messages content before text", async () => {
    const app = await setupWithUrlDownload({
      apiBaseUrl: "https://dashscope.example.com/api/v1/services/aigc/multimodal-generation",
      apiKey: "sk-qwen",
      provider: "qwen",
      model: "qwen-image-2.0-pro",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: "https://cdn.example.com/q.png" }] } }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeSingleImageEdit();
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // DashScope edit：content = [image dataURL, text]
    const content = (seen[0].input as { messages: { content: unknown[] }[] }).messages[0].content;
    expect(content).toHaveLength(2);
    expect((content[0] as { image: string }).image).toMatch(/^data:image\/png;base64,/);
    expect((content[1] as { text: string }).text).toBe("edit it");
    await app.close();
  });

  it("wan: edit sends image data URL in messages content", async () => {
    const app = await setupWithUrlDownload({
      apiBaseUrl: "https://dashscope.example.com/api/v1/services/aigc/multimodal-generation",
      apiKey: "sk-wan",
      provider: "wan",
      model: "wan2.7-image",
    });
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: "https://cdn.example.com/w.png" }] } }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeSingleImageEdit();
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    const content = (seen[0].input as { messages: { content: unknown[] }[] }).messages[0].content;
    expect((content[0] as { image: string }).image).toMatch(/^data:image\/png;base64,/);
    expect((content[1] as { text: string }).text).toBe("edit it");
    await app.close();
  });

  it("deepinfra: edit sends multipart image[] to upstream /edits", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://deepinfra.example.com/v1/openai/images",
      apiKey: "sk-di",
      provider: "deepinfra",
      model: "black-forest-labs/FLUX-kontext",
    });
    const seen: { url: string; contentType: string; body: Buffer }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url,
          contentType: (init.headers as Record<string, string>)["Content-Type"],
          body: Buffer.from(init.body as Uint8Array),
        });
        return new Response(
          JSON.stringify({ data: [{ b64_json: "UVdY" }] }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeSingleImageEdit();
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://deepinfra.example.com/v1/openai/images/edits");
    // 上游收到的应是 multipart，含 image[]
    const upstreamText = seen[0].body.toString("latin1");
    expect(upstreamText).toContain('name="image[]"');
    expect(upstreamText).toContain('name="model"');
    expect(upstreamText).toContain('name="prompt"');
    await app.close();
  });

  it("gemini: edit sends inline_data parts in contents", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://gemini.example.com",
      apiKey: "sk-gemini",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
    });
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, body: JSON.parse(init.body as string) });
        return new Response(
          JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  inlineData: { mimeType: "image/png", data: "UVdY" },
                }],
              },
            }],
          }),
          { status: 200 },
        );
      }),
    );

    const { boundary, body } = makeSingleImageEdit();
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    // edit：contents[0].parts 应含 text + inline_data
    const parts = (seen[0].body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    const hasInlineData = parts.some((p) => "inline_data" in p);
    expect(hasInlineData).toBe(true);
    const hasText = parts.some((p) => "text" in p);
    expect(hasText).toBe(true);
    await app.close();
  });

  it("glm: edit returns 501 (not supported)", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://glm.example.com/api/paas/v4/images",
      apiKey: "sk-glm",
      provider: "glm",
      model: "glm-image",
    });

    const { boundary, body } = makeSingleImageEdit();
    const res = await app.inject({
      method: "POST",
      url: "/images/edits",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(501);
    expect(res.json().error).toContain("不支持图片编辑");
    await app.close();
  });
});

/**
 * 回归守护：真实 HTTP 连接下，正常的异步 generate 请求不应被 withClientSignal 误判为取消。
 *
 * app.inject 走的是 mock HTTP，不会触发真实 socket 的 close 事件时序，因此无法复现
 * 「监听 req.raw 的 close 事件 → 请求体读完后立即触发 → async handler 还在 await
 * provider fetch 时就被 abort」的 bug。这里用真实端口 + http.request 发请求，
 * fetch 带人为延迟（模拟真实上游耗时），验证请求正常返回 200 而非 502/aborted。
 */
describe("images routes integration — withClientSignal does not abort normal requests", () => {
  it("returns 200 for a slow upstream (socket close timing)", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        fetchSignal = init.signal;
        // 模拟上游耗时（>50ms），期间 if socket close 事件过早触发就会被 abort
        await new Promise((r) => setTimeout(r, 80));
        return new Response(
          JSON.stringify({ data: [{ b64_json: "QUJD" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("server did not bind");
    }
    const { port } = address;

    const responseBody = await new Promise<string>((resolve, reject) => {
      const http = require("node:http");
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/images/generations",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength('{"model":"gpt-image-2","prompt":"a cat","size":"1024x1024"}'),
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve(body));
        },
      );
      req.on("error", reject);
      req.write('{"model":"gpt-image-2","prompt":"a cat","size":"1024x1024"}');
      req.end();
    });

    const parsed = JSON.parse(responseBody);
    expect(parsed.data?.[0]?.b64_json).toBe("QUJD");
    // abort 不应被触发——signal 必须保持未 abort
    expect(fetchSignal?.aborted).toBe(false);

    await app.close();
  });
});
