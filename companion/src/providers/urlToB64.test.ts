import { describe, expect, it, vi, afterEach } from "vitest";
import { urlToB64 } from "./urlToB64.js";

function makeFetchResponse(body: Buffer, status = 200): Response {
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("urlToB64", () => {
  it("converts image bytes to base64", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal("fetch", vi.fn(async () => makeFetchResponse(bytes)));

    const b64 = await urlToB64("https://example.com/img.png", { retries: 0 });
    // Buffer.from(bytes).toString("base64")
    expect(b64).toBe(bytes.toString("base64"));
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeFetchResponse(Buffer.from(""), 404)),
    );

    await expect(
      urlToB64("https://example.com/missing.png", { retries: 0 }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("retries on transient failure then succeeds", async () => {
    const bytes = Buffer.from([0x01, 0x02, 0x03]);
    const fetchImpl = vi
      .fn<[], Promise<Response>>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(makeFetchResponse(bytes));

    const b64 = await urlToB64("https://example.com/img.png", {
      retries: 2,
      fetchImpl,
    });

    expect(b64).toBe(bytes.toString("base64"));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", async () => {
    const fetchImpl = vi
      .fn<[], Promise<Response>>()
      .mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      urlToB64("https://example.com/img.png", {
        retries: 1,
        fetchImpl,
      }),
    ).rejects.toThrow(/已重试 1 次.*ECONNRESET/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
