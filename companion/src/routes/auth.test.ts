import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

let authRoutes: typeof import("./auth.js").authRoutes;

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock("../credentials.js"));

async function makeApp(creds: unknown) {
  vi.doMock("../credentials.js", () => ({
    loadCredentials: () => creds,
    maskApiKey: (k: string) => k.slice(0, 4) + "***",
  }));
  authRoutes = (await import("./auth.js")).authRoutes;
  const app: FastifyInstance = Fastify();
  app.register(authRoutes);
  return app;
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
    await app.close();
  });

  it("returns OpenAI capability + sizeConstraints for legacy creds (no provider field)", async () => {
    const app = await makeApp({
      apiBaseUrl: "https://api.example.com/v1/images",
      apiKey: "sk-abcdefghijk",
      savedAt: "2026-06-20T00:00:00.000Z",
    });
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body).toMatchObject({
      provider: "openai",
      ready: true,
      accountLabel: "sk-a***",
    });
    expect(body.capability.mask).toBe(true);
    expect(body.sizeConstraints.step).toBe(16);
    await app.close();
  });

  it("returns provider-specific metadata when provider field present", async () => {
    // 当前只有 openai adapter 注册，provider=openai 应直接透传
    const app = await makeApp({
      provider: "openai",
      apiBaseUrl: "https://api.example.com/v1/images",
      apiKey: "sk-test123456",
      model: "gpt-image-2",
      savedAt: "2026-06-20T00:00:00.000Z",
    });
    const res = await app.inject({ method: "GET", url: "/auth/status" });
    const body = res.json();
    expect(body.model).toBe("gpt-image-2");
    expect(body.provider).toBe("openai");
    await app.close();
  });
});
