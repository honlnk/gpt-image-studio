import { describe, expect, it } from "vitest";
import {
  resolveAdapter,
  isRegisteredProvider,
  listProviderIds,
} from "../registry.js";

describe("resolveAdapter", () => {
  it("returns the registered adapter for a known provider id", () => {
    const adapter = resolveAdapter({
      provider: "glm",
      apiBaseUrl: "https://x",
      apiKey: "y",
    });
    expect(adapter?.id).toBe("glm");
  });

  it("returns the openai adapter for every other registered id", () => {
    // 覆盖每个已注册 id 都能拿到非 null adapter，防止未来加 provider 时遗漏注册
    for (const id of listProviderIds()) {
      const adapter = resolveAdapter({
        provider: id,
        apiBaseUrl: "https://x",
        apiKey: "y",
      });
      expect(adapter, `provider "${id}" should resolve`).not.toBeNull();
      expect(adapter?.id).toBe(id);
    }
  });

  it("treats empty provider string as unknown (null)", () => {
    // 用的是 ?? 运算符：只有 null/undefined 才回退默认。
    // 空串被视为"明确传了但未知"——生产中 validateStore 已强制 entry.provider 非空，
    // 空串到不了这里；即使到达，和未知 id 语义一致都该让调用方感知。
    const adapter = resolveAdapter({
      provider: "",
      apiBaseUrl: "https://x",
      apiKey: "y",
    });
    expect(adapter).toBeNull();
  });

  it("falls back to openai when provider field is undefined (legacy compat)", () => {
    // 老 credentials.json 若缺 provider 字段（经 toProviderConfig ?? "openai" 兜底），
    // resolveAdapter 收到的 config.provider 是 "openai"，不会触发这个分支；
    // 这里直接测 resolveAdapter 对 undefined 的处理，确认 ?? DEFAULT_PROVIDER_ID 生效。
    const adapter = resolveAdapter({
      provider: undefined,
      apiBaseUrl: "https://x",
      apiKey: "y",
    } as { provider: string; apiBaseUrl: string; apiKey: string });
    expect(adapter?.id).toBe("openai");
  });

  it("returns null for unknown provider id (typo)", () => {
    const adapter = resolveAdapter({
      provider: "opneai",
      apiBaseUrl: "https://x",
      apiKey: "y",
    });
    expect(adapter).toBeNull();
  });

  it("returns null for unknown provider id (fake)", () => {
    const adapter = resolveAdapter({
      provider: "fake-provider",
      apiBaseUrl: "https://x",
      apiKey: "y",
    });
    expect(adapter).toBeNull();
  });
});

describe("isRegisteredProvider", () => {
  it("returns true for every id in listProviderIds", () => {
    for (const id of listProviderIds()) {
      expect(isRegisteredProvider(id), `id "${id}" should be registered`).toBe(true);
    }
  });

  it("returns true for known ids (spot check)", () => {
    expect(isRegisteredProvider("openai")).toBe(true);
    expect(isRegisteredProvider("deepinfra")).toBe(true);
    expect(isRegisteredProvider("gemini")).toBe(true);
  });

  it("returns false for typo / fake id", () => {
    expect(isRegisteredProvider("opneai")).toBe(false);
    expect(isRegisteredProvider("fake-provider")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isRegisteredProvider("")).toBe(false);
  });
});
