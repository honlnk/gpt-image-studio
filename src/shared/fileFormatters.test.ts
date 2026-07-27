import { describe, expect, it } from "vitest";
import {
  BYTE_GB,
  BYTE_KB,
  BYTE_MB,
  formatFileSize,
  formatFileSizeCompact,
  imageDownloadName,
  imageExtension,
} from "./fileFormatters";
import type { ImageAsset } from "../types/studio";

describe("formatFileSize", () => {
  it("returns 未知大小 for 0 / undefined / null", () => {
    expect(formatFileSize(0)).toBe("未知大小");
    expect(formatFileSize(undefined)).toBe("未知大小");
  });

  it("formats bytes below 1MB as KB (rounded up, min 1)", () => {
    expect(formatFileSize(1)).toBe("1 KB");
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(513)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(BYTE_MB - 1)).toBe("1024 KB");
  });

  it("formats bytes between 1MB and 1GB as MB (1 decimal)", () => {
    expect(formatFileSize(BYTE_MB)).toBe("1.0 MB");
    expect(formatFileSize(BYTE_MB * 2.5)).toBe("2.5 MB");
    // BYTE_GB - 1 仍在 MB 区（< 1GB）
    expect(formatFileSize(BYTE_GB - 1)).toBe("1024.0 MB");
  });

  it("formats bytes >= 1GB as GB (2 decimals)", () => {
    expect(formatFileSize(BYTE_GB)).toBe("1.00 GB");
    expect(formatFileSize(BYTE_GB * 2.5)).toBe("2.50 GB");
  });
});

describe("formatFileSizeCompact", () => {
  it("returns 0B for 0 / undefined / negative", () => {
    expect(formatFileSizeCompact(0)).toBe("0B");
    expect(formatFileSizeCompact(undefined)).toBe("0B");
    expect(formatFileSizeCompact(-1)).toBe("0B");
  });

  it("formats below 1KB as raw bytes with B suffix", () => {
    expect(formatFileSizeCompact(1)).toBe("1B");
    expect(formatFileSizeCompact(512)).toBe("512B");
    expect(formatFileSizeCompact(1023)).toBe("1023B");
  });

  it("formats below 1MB as KB (1 decimal)", () => {
    expect(formatFileSizeCompact(BYTE_KB)).toBe("1.0KB");
    expect(formatFileSizeCompact(BYTE_KB * 1.5)).toBe("1.5KB");
    // BYTE_MB - 1 仍在 KB 区，1048575/1024 ≈ 1024.0
    expect(formatFileSizeCompact(BYTE_MB - 1)).toBe("1024.0KB");
  });

  it("formats >= 1MB as MB (1 decimal)", () => {
    expect(formatFileSizeCompact(BYTE_MB)).toBe("1.0MB");
    expect(formatFileSizeCompact(BYTE_MB * 2.5)).toBe("2.5MB");
  });
});

describe("imageExtension", () => {
  it("maps jpeg mime to jpeg", () => {
    expect(imageExtension("image/jpeg")).toBe("jpeg");
  });

  it("maps webp mime to webp", () => {
    expect(imageExtension("image/webp")).toBe("webp");
  });

  it("falls back to png for png / unknown / undefined", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/gif")).toBe("png");
    expect(imageExtension(undefined)).toBe("png");
  });
});

describe("imageDownloadName", () => {
  it("uses asset.name + extension", () => {
    const image = { name: "my-art", mimeType: "image/jpeg" } as ImageAsset;
    expect(imageDownloadName(image)).toBe("my-art.jpeg");
  });

  it("falls back to 'image' when name is empty", () => {
    const image = { name: "", mimeType: "image/png" } as ImageAsset;
    expect(imageDownloadName(image)).toBe("image.png");
  });
});
