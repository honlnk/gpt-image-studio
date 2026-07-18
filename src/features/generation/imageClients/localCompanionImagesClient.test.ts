import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalCompanionImagesClient } from "./localCompanionImagesClient";
import type { ImageClient } from "./imageClient";

const PROMPT_REQUEST_SETTINGS = {
  promptMode: "default" as const,
  promptWordbanks: {
    pose: { safe: [], creative: [], nsfw: [] },
    adultInspiration: [],
  },
  promptRewriteGuardEnabled: false,
  promptRewriteGuardText: "",
};

function makeClient(): ImageClient {
  return createLocalCompanionImagesClient({
    getCompanionUrl: () => "http://127.0.0.1:19750",
    getAccessKey: () => "test-access-key",
    getModel: () => "gpt-image-2",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("localCompanionImagesClient.generate — mimeType reading", () => {
  it("reads mime_type from companion response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          { b64_json: "aGVsbG8=", revised_prompt: "rp", mime_type: "image/webp" },
        ],
      }),
    );

    const client = makeClient();
    const result = await client.generate({
      prompt: "a cat",
      params: {
        size: "1024x1024",
        resolution: "1k",
        width: 1024,
        height: 1024,
        imageCount: 1,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      },
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
    });

    expect(result.b64Json).toBe("aGVsbG8=");
    expect(result.mimeType).toBe("image/webp");
    // 发出的请求体应带 companion_resolution
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody.companion_resolution).toBe("1k");
  });

  it("returns mimeType as undefined when companion omits mime_type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }),
    );

    const client = makeClient();
    const result = await client.generate({
      prompt: "a cat",
      params: {
        size: "1024x1024",
        resolution: "1k",
        width: 1024,
        height: 1024,
        imageCount: 1,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      },
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
    });

    expect(result.mimeType).toBeUndefined();
  });

  it("throws when response has no b64_json", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: [{}] }),
    );

    const client = makeClient();
    await expect(
      client.generate({
        prompt: "a cat",
        params: {
          size: "1024x1024",
          resolution: "1k",
          width: 1024,
          height: 1024,
          imageCount: 1,
          quality: "auto",
          background: "auto",
          outputFormat: "png",
        },
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      }),
    ).rejects.toThrow(/没有 data\[0\]/);
  });

  it("surfaces upstream error message on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "provider down" } }, 502),
    );

    const client = makeClient();
    await expect(
      client.generate({
        prompt: "a cat",
        params: {
          size: "1024x1024",
          resolution: "1k",
          width: 1024,
          height: 1024,
          imageCount: 1,
          quality: "auto",
          background: "auto",
          outputFormat: "png",
        },
        promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      }),
    ).rejects.toThrow(/provider down/);
  });
});

describe("localCompanionImagesClient.edit — mimeType reading", () => {
  it("reads mime_type from edit response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: "ZWRpdGVk", mime_type: "image/jpeg" }],
      }),
    );

    const client = makeClient();
    const result = await client.edit({
      prompt: "make it blue",
      params: {
        size: "1024x1024",
        resolution: "1k",
        width: 1024,
        height: 1024,
        imageCount: 1,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
      },
      promptRequestSettings: PROMPT_REQUEST_SETTINGS,
      images: [{ blob: new Blob([new Uint8Array([0x89, 0x50])]), name: "ref.png" }],
    });

    expect(result.mimeType).toBe("image/jpeg");
  });
});
