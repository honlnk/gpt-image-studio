import { afterEach, describe, expect, it, vi } from "vitest";
import { buildModelsEndpoint, probeDirectApiModels } from "./models";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildModelsEndpoint", () => {
  it("appends /v1/models for origin mode", () => {
    expect(buildModelsEndpoint("https://api.example.com", "origin")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("replaces trailing images segment for full mode", () => {
    expect(
      buildModelsEndpoint("https://api.example.com/v1/images", "full"),
    ).toBe("https://api.example.com/v1/models");
  });

  it("appends /models when full mode url ends with /v1", () => {
    expect(buildModelsEndpoint("https://api.example.com/v1", "full")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("trims trailing slashes and returns empty for empty input", () => {
    expect(
      buildModelsEndpoint("https://api.example.com/v1/images/", "full"),
    ).toBe("https://api.example.com/v1/models");
    expect(buildModelsEndpoint("  ", "origin")).toBe("");
  });
});

describe("probeDirectApiModels", () => {
  it("returns model ids from the standard { data: [{ id }] } shape", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ data: [{ id: "gpt-image-2" }, { id: "gpt-image-2.5-flare" }] }),
      );

    const result = await probeDirectApiModels({
      apiBaseUrl: "https://api.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "sk-test",
    });

    expect(result).toEqual({
      ok: true,
      modelIds: ["gpt-image-2", "gpt-image-2.5-flare"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      { headers: { Authorization: "Bearer sk-test" } },
    );
  });

  it("accepts bare-array payloads and dedupes ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([{ id: "m-1" }, { id: "m-1" }, { id: "" }, { noId: true }]),
    );

    const result = await probeDirectApiModels({
      apiBaseUrl: "https://api.example.com/v1/images",
      apiBaseUrlMode: "full",
      apiKey: "sk-test",
    });

    expect(result).toEqual({ ok: true, modelIds: ["m-1"] });
  });

  it("maps 401/403 to invalidKey", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "Incorrect API key provided" } }, 401),
    );

    const result = await probeDirectApiModels({
      apiBaseUrl: "https://api.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "sk-bad",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidKey");
  });

  it("maps network failures to requestFailed without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    const result = await probeDirectApiModels({
      apiBaseUrl: "https://api.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("requestFailed");
      expect(result.message).toContain("Failed to fetch");
    }
  });

  it("rejects probing without an api key before any request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await probeDirectApiModels({
      apiBaseUrl: "https://api.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "  ",
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
