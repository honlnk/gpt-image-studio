import { describe, expect, it } from "vitest";
import {
  assertSignatureMatches,
  isJpeg,
  isPng,
  isWebp,
  sniffImageMimeType,
  sniffMimeTypeFromBase64,
} from "../imageSignature.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("imageSignature predicates", () => {
  it("isPng matches PNG signature", () => {
    expect(isPng(PNG_BYTES)).toBe(true);
    expect(isPng(Buffer.from([0x89, 0x50]))).toBe(false); // too short
    expect(isPng(JPEG_BYTES)).toBe(false);
  });

  it("isJpeg matches JPEG SOI marker", () => {
    expect(isJpeg(JPEG_BYTES)).toBe(true);
    expect(isJpeg(Buffer.from([0xff, 0xd8]))).toBe(false); // too short
    expect(isJpeg(PNG_BYTES)).toBe(false);
  });

  it("isWebp matches RIFF...WEBP", () => {
    expect(isWebp(WEBP_BYTES)).toBe(true);
    expect(isWebp(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBe(false); // too short
    expect(isWebp(PNG_BYTES)).toBe(false);
  });
});

describe("sniffImageMimeType", () => {
  it("returns the matching MIME for known signatures", () => {
    expect(sniffImageMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffImageMimeType(WEBP_BYTES)).toBe("image/webp");
  });

  it("returns null for unknown or empty buffers", () => {
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMimeType(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
    expect(sniffImageMimeType(Buffer.from("GIF89a", "ascii"))).toBeNull();
  });
});

describe("assertSignatureMatches", () => {
  it("passes when buffer matches declared MIME", () => {
    expect(() => assertSignatureMatches(PNG_BYTES, "image/png")).not.toThrow();
    expect(() => assertSignatureMatches(JPEG_BYTES, "image/jpeg")).not.toThrow();
    expect(() => assertSignatureMatches(WEBP_BYTES, "image/webp")).not.toThrow();
  });

  it("throws when buffer does not match declared MIME", () => {
    expect(() => assertSignatureMatches(PNG_BYTES, "image/jpeg")).toThrow(/不匹配/);
    expect(() => assertSignatureMatches(JPEG_BYTES, "image/png")).toThrow(/不匹配/);
    expect(() => assertSignatureMatches(WEBP_BYTES, "image/png")).toThrow(/不匹配/);
  });
});

describe("sniffMimeTypeFromBase64", () => {
  it("sniffs MIME from a base64 prefix", () => {
    expect(sniffMimeTypeFromBase64(PNG_BYTES.toString("base64"))).toBe("image/png");
    expect(sniffMimeTypeFromBase64(JPEG_BYTES.toString("base64"))).toBe("image/jpeg");
    expect(sniffMimeTypeFromBase64(WEBP_BYTES.toString("base64"))).toBe("image/webp");
  });

  it("works with long base64 strings (only decodes the prefix)", () => {
    const long = Buffer.concat([PNG_BYTES, Buffer.alloc(1000, 0x00)]);
    expect(sniffMimeTypeFromBase64(long.toString("base64"))).toBe("image/png");
  });

  it("returns null for empty or unrecognized input", () => {
    expect(sniffMimeTypeFromBase64("")).toBeNull();
    expect(sniffMimeTypeFromBase64(Buffer.from("hello world", "ascii").toString("base64"))).toBeNull();
  });
});
