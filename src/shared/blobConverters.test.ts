import { describe, expect, it } from "vitest";
import { base64ToBlob, blobToDataUrl } from "./blobConverters";

describe("base64ToBlob", () => {
  it("converts base64 string to Blob with given mime type", async () => {
    // "hello" 的 base64
    const b64 = btoa("hello");
    const blob = base64ToBlob(b64, "text/plain");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello");
  });

  it("handles empty base64 string", () => {
    const blob = base64ToBlob("", "image/png");
    expect(blob.size).toBe(0);
    expect(blob.type).toBe("image/png");
  });

  it("preserves binary bytes correctly", async () => {
    // 0..255 全字节
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const b64 = btoa(String.fromCharCode(...bytes));
    const blob = base64ToBlob(b64, "application/octet-stream");
    const result = new Uint8Array(await blob.arrayBuffer());
    expect(result).toEqual(bytes);
  });
});

describe("blobToDataUrl", () => {
  it("converts Blob to data URL with mime type", async () => {
    const blob = new Blob(["world"], { type: "text/plain" });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toBe(`data:text/plain;base64,${btoa("world")}`);
  });

  it("falls back to application/octet-stream when blob has no type", async () => {
    const blob = new Blob(["x"]);
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("roundtrips with base64ToBlob", async () => {
    const original = new Blob([new Uint8Array([0, 127, 200, 255])], { type: "image/png" });
    const dataUrl = await blobToDataUrl(original);
    const b64 = dataUrl.split(",")[1]!;
    const restored = base64ToBlob(b64, "image/png");
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(
      new Uint8Array(await original.arrayBuffer()),
    );
  });

  it("handles empty Blob (size === 0)", async () => {
    const emptyBlob = new Blob([]);
    const dataUrl = await blobToDataUrl(emptyBlob);
    // 空 Blob → btoa("") = ""，走 application/octet-stream 回退
    expect(dataUrl).toBe("data:application/octet-stream;base64,");
  });
});
