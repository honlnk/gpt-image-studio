import { describe, expect, it } from "vitest";
import { createSecurityConfig } from "../securityConfig.js";
import { extractBoundary, parseMultipart } from "../providers/multipart.js";
import { validateEditMultipart } from "./images.js";

function multipart(parts: Array<{ name: string; contentType?: string; body?: string }>): Buffer {
  const boundary = "----test-boundary";
  const content = parts.map((part) => {
    const headers = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${part.name}"; filename="${part.name}.bin"`,
    part.contentType ? `Content-Type: ${part.contentType}` : undefined,
    ].filter(Boolean);
    return `${headers.join("\r\n")}\r\n\r\n${part.body ?? "data"}`;
  }).join("\r\n")
    + `\r\n--${boundary}--\r\n`;

  return Buffer.from(content, "latin1");
}

function validateMultipart(
  body: Buffer,
  security = createSecurityConfig({ channel: "dev" }),
): string | null {
  const boundary = extractBoundary("multipart/form-data; boundary=----test-boundary");
  if (!boundary) throw new Error("test boundary missing");
  const parsed = parseMultipart(body, boundary);
  if ("message" in parsed) return parsed.message;
  return validateEditMultipart(parsed, security);
}

describe("companion image route validation", () => {
  const security = createSecurityConfig({ channel: "dev" });

  it("accepts image references and png mask", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toBeNull();
  });

  it("requires at least one image", () => {
    const body = multipart([
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("至少需要一张引用图片");
  });

  it("rejects too many image references", () => {
    const body = multipart(Array.from({ length: 17 }, () => ({
      name: "image[]",
      contentType: "image/png",
    })));

    expect(validateMultipart(body, security)).toContain("最多支持 16 张引用图片");
  });

  it("rejects unsupported image mime types", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/gif" },
    ]);

    expect(validateMultipart(body, security)).toContain("不支持的图片类型");
  });

  it("requires mask to be png", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/jpeg" },
    ]);

    expect(validateMultipart(body, security)).toContain("mask 必须是 image/png");
  });

  it("rejects unknown file fields during structured parsing", () => {
    const body = multipart([
      { name: "reference", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("不支持的文件字段");
  });

  it("rejects empty image files", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png", body: "" },
    ]);

    expect(validateMultipart(body, security)).toContain("不能为空");
  });

  it("rejects image parts without Content-Type", () => {
    const body = multipart([
      { name: "image[]", body: "png" },
    ]);

    expect(validateMultipart(body, security)).toContain("缺少 Content-Type");
  });

  it("rejects a duplicate mask", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("mask 只能有一个");
  });

});
