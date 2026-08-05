import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileSystemImageStore,
  validateCustomDirectory,
} from "./fileSystemImageStore.js";
import { EXT_TO_MIME, FALLBACK_MIME, MIME_TO_EXT } from "./imageStore.js";

/**
 * FileSystemImageStore 单元测试：选项 A（opaqueNaming=false）和 B（opaqueNaming=true）。
 * validateCustomDirectory 的合法性校验。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-fsimg-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileSystemImageStore 选项 B（opaqueNaming=true）", () => {
  it("save 写入文件名 = blobKey（无扩展名）", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    await store.save("blob-1", Buffer.from("png-data"), "image/png");
    expect(existsSync(join(tempDir, "imgs", "blob-1"))).toBe(true);
    expect(existsSync(join(tempDir, "imgs", "blob-1.png"))).toBe(false);
  });

  it("save 返回字节大小", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    const data = Buffer.from("hello-world");
    const result = await store.save("k1", data, "image/png");
    expect(result.size).toBe(data.byteLength);
    expect(result.mimeType).toBe("image/png");
  });

  it("load 往返一致，mimeType 返回 FALLBACK_MIME（无法反推）", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    const data = Buffer.from("png-bytes");
    await store.save("k1", data, "image/png");
    const loaded = await store.load("k1");
    expect(loaded).toBeDefined();
    expect(loaded!.data).toEqual(data);
    expect(loaded!.mimeType).toBe(FALLBACK_MIME);
  });

  it("load 不存在返回 undefined", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    expect(await store.load("nope")).toBeUndefined();
  });

  it("remove 删除文件", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    await store.save("k1", Buffer.from("x"), "image/png");
    await store.remove("k1");
    expect(await store.load("k1")).toBeUndefined();
  });

  it("remove 不存在的 key 是 no-op", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    await expect(store.remove("nope")).resolves.toBeUndefined();
  });

  it("rootDir 不存在时首次 save 自动创建", async () => {
    const rootDir = join(tempDir, "nested", "imgs");
    expect(existsSync(rootDir)).toBe(false);
    const store = createFileSystemImageStore({
      rootDir,
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    await store.save("k1", Buffer.from("x"), "image/png");
    expect(existsSync(rootDir)).toBe(true);
  });
});

describe("FileSystemImageStore 选项 A（opaqueNaming=false）", () => {
  it("save 写入文件名 = blobKey + 扩展名", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    await store.save("blob-1", Buffer.from("png-data"), "image/png");
    expect(existsSync(join(tempDir, "imgs", "blob-1.png"))).toBe(true);
  });

  it("load 按 blobKey 匹配并从扩展名反推 mimeType", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    const data = Buffer.from("webp-bytes");
    await store.save("k1", data, "image/webp");
    const loaded = await store.load("k1");
    expect(loaded).toBeDefined();
    expect(loaded!.data).toEqual(data);
    expect(loaded!.mimeType).toBe("image/webp");
  });

  it("load 不存在返回 undefined", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    expect(await store.load("nope")).toBeUndefined();
  });

  it("remove 删除带扩展名的文件", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    await store.save("k1", Buffer.from("x"), "image/jpeg");
    expect(existsSync(join(tempDir, "imgs", "k1.jpg"))).toBe(true);
    await store.remove("k1");
    expect(existsSync(join(tempDir, "imgs", "k1.jpg"))).toBe(false);
  });

  it("blobKey 精确匹配：key=a 不误匹配 ab.png", async () => {
    const imgsDir = join(tempDir, "imgs");
    mkdirSync(imgsDir, { recursive: true });
    // 手动写入一个 ab.png，确保 load("a") 不会匹配到它
    writeFileSync(join(imgsDir, "ab.png"), Buffer.from("other"));
    const store = createFileSystemImageStore({
      rootDir: imgsDir,
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    expect(await store.load("a")).toBeUndefined();
    expect(await store.load("ab")).toBeDefined();
  });

  it("未知 mimeType 用 bin 扩展名", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    await store.save("k1", Buffer.from("x"), "application/x-unknown");
    expect(existsSync(join(tempDir, "imgs", "k1.bin"))).toBe(true);
    const loaded = await store.load("k1");
    expect(loaded).toBeDefined();
    expect(loaded!.mimeType).toBe(FALLBACK_MIME); // bin 不在 EXT_TO_MIME
  });
});

describe("estimateBytes", () => {
  it("空目录返回 0", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    expect(await store.estimateBytes()).toBe(0);
  });

  it("累加所有文件大小", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "imgs"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    await store.save("k1", Buffer.alloc(100), "image/png");
    await store.save("k2", Buffer.alloc(200), "image/png");
    await store.save("k3", Buffer.alloc(300), "image/png");
    expect(await store.estimateBytes()).toBe(600);
  });

  it("不存在的 rootDir 返回 0", async () => {
    const store = createFileSystemImageStore({
      rootDir: join(tempDir, "never-created"),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    expect(await store.estimateBytes()).toBe(0);
  });
});

describe("kind 属性", () => {
  it("选项 B 的 kind 是 filesystem-default", () => {
    const store = createFileSystemImageStore({
      rootDir: tempDir,
      opaqueNaming: true,
      kind: "filesystem-default",
    });
    expect(store.kind).toBe("filesystem-default");
  });

  it("选项 A 的 kind 是 filesystem-custom", () => {
    const store = createFileSystemImageStore({
      rootDir: tempDir,
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
    expect(store.kind).toBe("filesystem-custom");
  });
});

describe("validateCustomDirectory", () => {
  it("合法目录返回 undefined", () => {
    expect(validateCustomDirectory(tempDir)).toBeUndefined();
  });

  it("相对路径拒绝（NOT_ABSOLUTE）", () => {
    const err = validateCustomDirectory("relative/path");
    expect(err?.code).toBe("NOT_ABSOLUTE");
  });

  it("不存在目录拒绝（NOT_EXIST）", () => {
    const err = validateCustomDirectory(join(tempDir, "nope"));
    expect(err?.code).toBe("NOT_EXIST");
  });

  it("路径是文件不是目录拒绝（NOT_EXIST）", () => {
    const filepath = join(tempDir, "afile");
    writeFileSync(filepath, "x");
    const err = validateCustomDirectory(filepath);
    expect(err?.code).toBe("NOT_EXIST");
    expect(err?.message).toContain("不是目录");
  });

  it("系统敏感目录拒绝（FORBIDDEN_SYSTEM_DIR）", () => {
    expect(validateCustomDirectory("/")?.code).toBe("FORBIDDEN_SYSTEM_DIR");
    expect(validateCustomDirectory("/etc")?.code).toBe("FORBIDDEN_SYSTEM_DIR");
    expect(validateCustomDirectory("/usr")?.code).toBe("FORBIDDEN_SYSTEM_DIR");
    expect(validateCustomDirectory("/System")?.code).toBe("FORBIDDEN_SYSTEM_DIR");
  });

  it("normalize 后的系统目录也被拒绝（带尾斜杠）", () => {
    expect(validateCustomDirectory("/etc/")?.code).toBe("FORBIDDEN_SYSTEM_DIR");
    expect(validateCustomDirectory("/usr/local/../..")?.code).toBe(
      "FORBIDDEN_SYSTEM_DIR",
    );
  });
});

describe("MIME 映射常量", () => {
  it("MIME_TO_EXT 包含常见图片类型", () => {
    expect(MIME_TO_EXT["image/png"]).toBe("png");
    expect(MIME_TO_EXT["image/webp"]).toBe("webp");
    expect(MIME_TO_EXT["image/jpeg"]).toBe("jpg");
  });

  it("EXT_TO_MIME 是 MIME_TO_EXT 的近似逆映射", () => {
    expect(EXT_TO_MIME["png"]).toBe("image/png");
    expect(EXT_TO_MIME["webp"]).toBe("image/webp");
    expect(EXT_TO_MIME["jpg"]).toBe("image/jpeg");
  });
});
