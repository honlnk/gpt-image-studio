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

async function setupWithCredentials(creds: {
  apiBaseUrl: string;
  apiKey: string;
  provider?: string;
  model?: string;
} | null) {
  vi.doMock("../credentials.js", () => ({
    loadCredentials: () => creds,
    maskApiKey: (k: string) => k.slice(0, 4) + "***",
  }));
  const mod = await import("./images.js");
  imagesRoutes = mod.imagesRoutes;
  return makeApp();
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
      payload: { model: "gpt-image-2", prompt: "a cat", size: "1024x1024", quality: "high" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [{ b64_json: "QUJD", revised_prompt: "rp" }],
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
    expect(res.json()).toEqual({ data: [{ b64_json: "UVdY", revised_prompt: undefined }] });

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

describe("provider config passthrough", () => {
  it("passes provider field through to adapter resolution (regression: old creds without provider)", async () => {
    // 老 credentials.json 无 provider 字段 → 应回退 openai，正常工作
    const app = await setupWithCredentials({
      apiBaseUrl: "https://up.example.com/v1/images",
      apiKey: "sk-test",
      // 故意不传 provider
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
