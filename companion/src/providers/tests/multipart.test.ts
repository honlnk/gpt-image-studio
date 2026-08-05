import { describe, expect, it } from "vitest";
import { extractBoundary, parseMultipart } from "../multipart.js";

/** 构造一个真实的 multipart/form-data Buffer，模拟 web 发出的编辑请求。 */
function buildMultipart(parts: Array<{
  name: string;
  filename?: string;
  contentType?: string;
  body: Buffer | string;
}>): { boundary: string; buffer: Buffer } {
  const boundary = "----test-boundary-12345";
  const crlf = "\r\n";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const headers: string[] = [`--${boundary}`];
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    headers.push(`Content-Disposition: ${disposition}`);
    if (part.contentType) headers.push(`Content-Type: ${part.contentType}`);
    chunks.push(Buffer.from(headers.join(crlf) + crlf + crlf, "utf8"));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body, "utf8"));
    chunks.push(Buffer.from(crlf, "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));
  return { boundary, buffer: Buffer.concat(chunks) };
}

describe("extractBoundary", () => {
  it("extracts quoted boundary", () => {
    expect(extractBoundary('multipart/form-data; boundary="abc123"')).toBe("abc123");
  });
  it("extracts unquoted boundary", () => {
    expect(extractBoundary("multipart/form-data; boundary=abc123")).toBe("abc123");
  });
  it("returns null when missing", () => {
    expect(extractBoundary("multipart/form-data")).toBeNull();
  });
});

describe("parseMultipart", () => {
  it("extracts image[], mask, and text fields", () => {
    const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // fake PNG header
    const maskBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { boundary, buffer } = buildMultipart([
      { name: "model", body: "gpt-image-2" },
      { name: "prompt", body: "make it blue" },
      { name: "size", body: "1024x1024" },
      { name: "quality", body: "high" },
      { name: "stream", body: "true" },
      { name: "image[]", filename: "a.png", contentType: "image/png", body: imgBytes },
      { name: "image[]", filename: "b.png", contentType: "image/png", body: imgBytes },
      { name: "mask", filename: "mask.png", contentType: "image/png", body: maskBytes },
    ]);

    const result = parseMultipart(buffer, boundary);
    expect("message" in result).toBe(false);
    if ("message" in result) return;

    expect(result.fields).toEqual({
      model: "gpt-image-2",
      prompt: "make it blue",
      size: "1024x1024",
      quality: "high",
      stream: "true",
    });
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toEqual({
      blob: imgBytes,
      name: "a.png",
      mimeType: "image/png",
    });
    expect(result.images[1].name).toBe("b.png");
    expect(result.mask).toEqual({
      blob: maskBytes,
      name: "mask.png",
      mimeType: "image/png",
    });
  });

  it("preserves binary body bytes exactly", () => {
    // 含 0x00 和高位字节的 buffer，验证不被字符串转换破坏
    const binary = Buffer.from([0x00, 0xff, 0x89, 0x0d, 0x0a, 0x50, 0x00]);
    const { boundary, buffer } = buildMultipart([
      { name: "image[]", filename: "x.png", contentType: "image/png", body: binary },
    ]);

    const result = parseMultipart(buffer, boundary);
    if ("message" in result) throw new Error("parse failed");
    expect(Buffer.compare(result.images[0].blob, binary)).toBe(0);
  });

  it("returns images empty when no file parts", () => {
    const { boundary, buffer } = buildMultipart([
      { name: "model", body: "gpt-image-2" },
      { name: "prompt", body: "x" },
    ]);
    const result = parseMultipart(buffer, boundary);
    if ("message" in result) throw new Error("parse failed");
    expect(result.images).toEqual([]);
    expect(result.mask).toBeUndefined();
  });
});
