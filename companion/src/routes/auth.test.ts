import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

let authRoutes: typeof import("./auth.js").authRoutes;

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock("../credentials.js"));

/**
 * mock getActiveCredential：返回 CredentialEntry 或 null。
 * 测试只关心 /auth/status 的回流，不碰真实文件系统。
 *
 * 损坏探测由 /credentials 负责（它返 500+corrupt）；/auth/status 用
 * getActiveCredential，它内部 catch CredentialStoreError 返 null，
 * 让本路由走「无凭据」正常分支——所以这里只需 mock getActiveCredential。
 */
async function makeApp(creds: unknown) {
  vi.doMock("../credentials.js", () => ({
    getActiveCredential: () => creds,
  }));
  authRoutes = (await import("./auth.js")).authRoutes;
  const app: FastifyInstance = Fastify();
  app.register(authRoutes);
  return app;
}

/** 构造 CredentialEntry 的辅助函数，减少重复。 */
function entry(overrides: Partial<{
  id: string;
  label: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: "test-id",
    label: "测试配置",
    provider: "openai",
    apiBaseUrl: "https://api.example.com/v1/images",
    apiKey: "sk-test123456",
    model: "gpt-image-2",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("/auth/status provider info backflow", () => {
  it("returns OpenAI defaults when no credentials", async () => {
    const app = await makeApp(null);
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      provider: "openai",
      ready: false,
      model: "",
    });
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: true,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "webp", "jpeg"],
    });
    expect(body.sizeConstraints).toMatchObject({
      step: 16,
      max: 3840,
      maxPixels: 8294400,
    });
    // 无凭据回流 OpenAI 默认档位 [1k, 2k, 4k]
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
      "4k",
    ]);
    await app.close();
  });

  it("returns OpenAI capability + sizeConstraints for openai provider", async () => {
    const app = await makeApp(
      entry({
        provider: "openai",
        apiKey: "sk-test123456",
        model: "gpt-image-2",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body).toMatchObject({
      provider: "openai",
      ready: true,
      accountLabel: "测试配置",
    });
    expect(body.capability.mask).toBe(true);
    expect(body.sizeConstraints.step).toBe(16);
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
      "4k",
    ]);
    await app.close();
  });

  it("returns provider-specific metadata when provider field present", async () => {
    const app = await makeApp(
      entry({ provider: "openai", model: "gpt-image-2" }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.model).toBe("gpt-image-2");
    expect(body.provider).toBe("openai");
    await app.close();
  });

  it("returns GLM capability + constraints when provider=glm (drives UI to hide unsupported options)", async () => {
    const app = await makeApp(
      entry({
        provider: "glm",
        apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4/images",
        apiKey: "glm-abc123",
        model: "glm-image",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("glm");
    expect(body.model).toBe("glm-image");
    // GLM 能力：不支持编辑/mask、无透明背景、无 webp
    expect(body.capability).toEqual({
      generate: true,
      edit: false,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg"],
    });
    // GLM size 约束：step=32, 512-2048, maxPixels=4194304
    expect(body.sizeConstraints).toMatchObject({
      step: 32,
      min: 512,
      max: 2048,
      maxPixels: 4194304,
    });
    // GLM 档位：maxPixels=4M 到不了 4K，只声明 [1k, 2k]
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
    ]);
    await app.close();
  });

  it("returns Doubao capability + constraints when provider=doubao", async () => {
    const app = await makeApp(
      entry({
        provider: "doubao",
        apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images",
        apiKey: "doubao-test",
        model: "doubao-seedream-5-0-lite",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("doubao");
    expect(body.model).toBe("doubao-seedream-5-0-lite");
    // 豆包能力：支持编辑、不支持 mask、无透明背景、无 webp
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg"],
    });
    // 豆包 size 约束：step=1（无步长）、minPixels=3686400（有下限）、maxPixels=2^24
    expect(body.sizeConstraints).toMatchObject({
      step: 1,
      minPixels: 3686400,
      maxPixels: 16777216,
      maxAspectRatio: 16,
    });
    // 豆包档位：[2k, 3k, 4k]（无 1k，有原生 3k）
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "2k",
      "3k",
      "4k",
    ]);
    await app.close();
  });

  it("returns Qwen capability + constraints when provider=qwen", async () => {
    const app = await makeApp(
      entry({
        provider: "qwen",
        apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
        apiKey: "qwen-test",
        model: "qwen-image-2.0-pro",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("qwen");
    expect(body.model).toBe("qwen-image-2.0-pro");
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto"],
      outputFormats: ["png"],
    });
    expect(body.sizeConstraints).toMatchObject({
      step: 1,
      min: 512,
      max: 8192,
      minPixels: 262144,
      maxPixels: 4194304,
    });
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
    ]);
    await app.close();
  });

  it("returns Wan capability + constraints when provider=wan", async () => {
    const app = await makeApp(
      entry({
        provider: "wan",
        apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
        apiKey: "wan-test",
        model: "wan2.7-image",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("wan");
    expect(body.model).toBe("wan2.7-image");
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto"],
      outputFormats: ["png"],
    });
    expect(body.sizeConstraints).toMatchObject({
      step: 1,
      min: 768,
      max: Math.floor((2048 * 2048) / 768),
      minPixels: 589824,
      maxPixels: 4194304,
      maxAspectRatio: 8,
    });
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
    ]);
    await app.close();
  });

  it("returns Wan Pro 4K text-to-image constraints when model=wan2.7-image-pro", async () => {
    const app = await makeApp(
      entry({
        provider: "wan",
        apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation",
        apiKey: "wan-test",
        model: "wan2.7-image-pro",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("wan");
    expect(body.model).toBe("wan2.7-image-pro");
    expect(body.sizeConstraints).toMatchObject({
      step: 1,
      min: 768,
      max: Math.floor((4096 * 4096) / 768),
      minPixels: 589824,
      maxPixels: 16777216,
      maxAspectRatio: 8,
    });
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
      "4k",
    ]);
    await app.close();
  });

  it("returns Grok capability + constraints when provider=grok", async () => {
    const app = await makeApp(
      entry({
        provider: "grok",
        apiBaseUrl: "https://api.x.ai/v1/images",
        apiKey: "xai-test",
        model: "grok-imagine-image",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("grok");
    expect(body.model).toBe("grok-imagine-image");
    // Grok 能力：支持编辑、不支持 mask、无透明背景
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg", "webp"],
    });
    // Grok 档位：[1k, 2k]（官方 ImageResolution 枚举）
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "1k",
      "2k",
    ]);
    await app.close();
  });

  it("returns Gemini capability + constraints when provider=gemini", async () => {
    const app = await makeApp(
      entry({
        provider: "gemini",
        apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: "gemini-test",
        model: "gemini-2.5-flash-image",
      }),
    );
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.provider).toBe("gemini");
    expect(body.model).toBe("gemini-2.5-flash-image");
    // Gemini 能力：支持编辑（generateContent + inline_data）、不支持 mask、无透明背景
    expect(body.capability).toEqual({
      generate: true,
      edit: true,
      mask: false,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "jpeg", "webp"],
    });
    // Gemini 档位：[512, 1k, 2k, 4k]
    expect(body.resolutionOptions.map((o: { value: string }) => o.value)).toEqual([
      "512",
      "1k",
      "2k",
      "4k",
    ]);
    await app.close();
  });
});
