import { describe, expect, it } from "vitest";
import { createSecurityConfig } from "../securityConfig.js";
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

describe("companion image route validation", () => {
  const security = createSecurityConfig({ channel: "dev" });

  it("accepts image references and png mask", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateEditMultipart(body, security)).toBeNull();
  });

  it("requires at least one image", () => {
    const body = multipart([
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateEditMultipart(body, security)).toContain("至少需要一张引用图片");
  });

  it("rejects too many image references", () => {
    const body = multipart(Array.from({ length: 17 }, () => ({
      name: "image[]",
      contentType: "image/png",
    })));

    expect(validateEditMultipart(body, security)).toContain("最多支持 16 张引用图片");
  });

  it("rejects unsupported image mime types", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/gif" },
    ]);

    expect(validateEditMultipart(body, security)).toContain("不支持的图片类型");
  });

  it("requires mask to be png", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/jpeg" },
    ]);

    expect(validateEditMultipart(body, security)).toContain("mask 必须是 image/png");
  });
});
