import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeFilesystemFingerprint,
  computeOssFingerprint,
  normalizeDirectory,
} from "./fingerprint.js";

/**
 * fingerprint.ts 测试：配置指纹计算 + 目录归一化。
 *
 * 注意：macOS 上 /var 是 /private/var 的软链，mkdtempSync(tmpdir()) 返回 /var/...
 * 但 realpathSync 解析成 /private/var/...。测试期望值统一用 realpathSync 得到真实路径。
 */

let tempDir: string;
let realTempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-fp-test-"));
  realTempDir = realpathSync(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("computeFilesystemFingerprint", () => {
  it("格式为 fs:<归一化路径>", () => {
    const fp = computeFilesystemFingerprint(tempDir);
    expect(fp).toBe(`fs:${realTempDir}`);
  });

  it("去尾斜杠", () => {
    const withSlash = `${tempDir}/`;
    const fp = computeFilesystemFingerprint(withSlash);
    expect(fp).toBe(`fs:${realTempDir}`);
  });

  it("realpathSync 解软链：符号链接和真实路径生成同一指纹", () => {
    const realDir = join(tempDir, "real");
    const linkDir = join(tempDir, "link");
    mkdirSync(realDir, { recursive: true });
    try {
      symlinkSync(realDir, linkDir, "dir");
    } catch {
      // 某些环境（Windows 无权限 / CI sandbox）无法创建软链，跳过此用例
      return;
    }
    const fpReal = computeFilesystemFingerprint(realDir);
    const fpLink = computeFilesystemFingerprint(linkDir);
    expect(fpLink).toBe(fpReal);
  });
});

describe("computeOssFingerprint", () => {
  it("格式为 oss:<endpoint>:<bucket>:<prefix>", () => {
    const fp = computeOssFingerprint({
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "my-bucket",
      prefix: "gpt-image-studio",
    });
    expect(fp).toBe("oss:oss-cn-hangzhou.aliyuncs.com:my-bucket:gpt-image-studio");
  });

  it("endpoint 去尾斜杠 + 小写化", () => {
    const fp = computeOssFingerprint({
      endpoint: "OSS-CN-Hangzhou.Aliyuncs.com/",
      bucket: "MyBucket",
      prefix: "prefix",
    });
    expect(fp).toBe("oss:oss-cn-hangzhou.aliyuncs.com:mybucket:prefix");
  });

  it("bucket 小写化", () => {
    const fp = computeOssFingerprint({
      endpoint: "e.com",
      bucket: "My-BUCKET",
      prefix: "p",
    });
    expect(fp).toContain(":my-bucket:");
  });

  it("prefix 去首尾斜杠", () => {
    const fp = computeOssFingerprint({
      endpoint: "e.com",
      bucket: "b",
      prefix: "/some/prefix/",
    });
    expect(fp).toBe("oss:e.com:b:some/prefix");
  });

  it("空 prefix", () => {
    const fp = computeOssFingerprint({
      endpoint: "e.com",
      bucket: "b",
      prefix: "",
    });
    expect(fp).toBe("oss:e.com:b:");
  });

  it("不含 AccessKey（凭证变更不影响身份）", () => {
    const base = { endpoint: "e.com", bucket: "b", prefix: "p" };
    const fp1 = computeOssFingerprint(base);
    // 指纹函数根本不接收 AccessKey 参数，结构上保证不含
    expect(fp1).not.toContain("LTAI");
    expect(fp1).not.toContain("secret");
  });

  it("同配置同指纹", () => {
    const cfg = { endpoint: "e.com", bucket: "b", prefix: "p" };
    expect(computeOssFingerprint(cfg)).toBe(computeOssFingerprint(cfg));
  });

  it("不同配置不同指纹", () => {
    const fp1 = computeOssFingerprint({ endpoint: "e.com", bucket: "b1", prefix: "p" });
    const fp2 = computeOssFingerprint({ endpoint: "e.com", bucket: "b2", prefix: "p" });
    expect(fp1).not.toBe(fp2);
  });
});

describe("normalizeDirectory", () => {
  it("返回真实路径（去尾斜杠）", () => {
    expect(normalizeDirectory(`${tempDir}/`)).toBe(realTempDir);
  });

  it("目录不存在时降级用 resolve（不抛错）", () => {
    const nonexistent = join(tempDir, "never-exists");
    expect(() => normalizeDirectory(nonexistent)).not.toThrow();
    // 降级路径保留逻辑绝对路径（可能含软链前缀，但稳定）
    expect(normalizeDirectory(nonexistent)).toBe(nonexistent);
  });
});
