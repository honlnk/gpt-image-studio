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

  it("returns disconnect message with 502 when fetch throws", async () => {
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    const res = await app.inject({
      method: "POST",
      url: "/images/generations",
      headers: { "content-type": "application/json" },
      payload: { model: "gpt-image-2", prompt: "x" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("服务器主动断开");
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
