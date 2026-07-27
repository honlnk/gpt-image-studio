import { describe, expect, it, vi } from "vitest";
import { createOssImageStore, testOssConnection, type OssLikeClient } from "./ossImageStore.js";

/**
 * OssImageStore 测试：用 clientOverride 注入 mock client，不连真实 OSS。
 * 测试覆盖 save/load/remove/estimateBytes 的语义 + 错误处理。
 *
 * 注意：不测真实 OSS 调用（需真实凭据 + 网络），连通性测试函数 testOssConnection
 * 只测 mock 场景的错误分支。
 */

function makeMockClient(): OssLikeClient & {
  _store: Map<string, { data: Buffer; contentType: string; size: number }>;
} {
  const store = new Map<string, { data: Buffer; contentType: string; size: number }>();
  return {
    _store: store,
    put: vi.fn(async (name: string, data: Buffer, options?: { mime?: string; headers?: Record<string, string> }) => {
      // header 名大小写不敏感取 content-type（模拟真实 OSS 规范化）
      const headers = options?.headers ?? {};
      const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
      const contentType = (ctKey ? headers[ctKey] : options?.mime) ?? "application/octet-stream";
      store.set(name, { data, contentType, size: data.byteLength });
      return { name };
    }),
    get: vi.fn(async (name: string) => {
      const entry = store.get(name);
      if (!entry) {
        const err = Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey", status: 404 });
        throw err;
      }
      return {
        content: entry.data,
        res: { headers: { "content-type": entry.contentType } },
      };
    }),
    delete: vi.fn(async (name: string) => {
      if (!store.has(name)) {
        throw Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey", status: 404 });
      }
      store.delete(name);
      return {};
    }),
    list: vi.fn(async (query: Record<string, unknown>) => {
      const prefix = (query.prefix as string) ?? "";
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({ name: k, size: v.size }));
      return { objects, isTruncated: false };
    }),
  };
}

describe("OssImageStore", () => {
  it("save 上传并记录 mimeType", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "oss-cn-hangzhou.aliyuncs.com",
      bucket: "test-bucket",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "gpt-image-studio",
      clientOverride: mock,
    });
    const result = await store.save("blob-1", Buffer.from("png-data"), "image/png");
    expect(result.size).toBe(8);
    expect(result.mimeType).toBe("image/png");
    expect(mock._store.has("gpt-image-studio/blob-1")).toBe(true);
    expect(mock._store.get("gpt-image-studio/blob-1")?.contentType).toBe("image/png");
  });

  it("save 返回字节大小", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    const data = Buffer.alloc(256);
    const result = await store.save("k1", data, "image/webp");
    expect(result.size).toBe(256);
  });

  it("load 往返一致，从 OSS 响应头取 mimeType", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    await store.save("k1", Buffer.from("data"), "image/jpeg");
    const loaded = await store.load("k1");
    expect(loaded).toBeDefined();
    expect(loaded!.data.toString()).toBe("data");
    expect(loaded!.mimeType).toBe("image/jpeg");
  });

  it("load 不存在返回 undefined（NoSuchKey 视为不存在）", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    expect(await store.load("nope")).toBeUndefined();
  });

  it("load 非 NoSuchKey 错误向上抛", async () => {
    const mock = makeMockClient();
    mock.get = vi.fn(async () => {
      throw Object.assign(new Error("AccessDenied"), { code: "AccessDenied", status: 403 });
    });
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    await expect(store.load("k1")).rejects.toThrow();
  });

  it("remove 删除对象", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    await store.save("k1", Buffer.from("x"), "image/png");
    await store.remove("k1");
    expect(await store.load("k1")).toBeUndefined();
  });

  it("remove 不存在是 no-op（NoSuchKey 吞掉）", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    await expect(store.remove("nope")).resolves.toBeUndefined();
  });

  it("estimateBytes 累加 prefix 下所有对象大小", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    await store.save("k1", Buffer.alloc(100), "image/png");
    await store.save("k2", Buffer.alloc(200), "image/png");
    await store.save("k3", Buffer.alloc(300), "image/png");
    expect(await store.estimateBytes()).toBe(600);
  });

  it("estimateBytes 空返回 0", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    expect(await store.estimateBytes()).toBe(0);
  });

  it("prefix 归一化：补尾斜杠", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "/my/prefix/",
      clientOverride: mock,
    });
    await store.save("k1", Buffer.from("x"), "image/png");
    expect(mock._store.has("my/prefix/k1")).toBe(true);
  });

  it("空 prefix 允许", async () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "",
      clientOverride: mock,
    });
    await store.save("k1", Buffer.from("x"), "image/png");
    expect(mock._store.has("k1")).toBe(true);
  });

  it("kind 是 oss", () => {
    const mock = makeMockClient();
    const store = createOssImageStore({
      endpoint: "e",
      bucket: "b",
      accessKeyId: "ak",
      accessKeySecret: "sk",
      prefix: "p",
      clientOverride: mock,
    });
    expect(store.kind).toBe("oss");
  });
});

describe("testOssConnection", () => {
  // testOssConnection 内部 new OSS，无法注入 mock，只能测它对错误的处理。
  // 这里用无效凭据触发错误（不连真实 OSS，ali-oss 会因网络/鉴权失败抛错）。
  it("无效配置返回 ok:false（不抛错）", async () => {
    // 用一个明显不存在的 endpoint，ali-oss 会快速失败
    const result = await testOssConnection(
      {
        endpoint: "https://invalid-endpoint-nonexistent.invalid",
        bucket: "no-bucket",
        accessKeyId: "invalid",
        accessKeySecret: "invalid",
      },
      "test",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 15000); // 网络超时给足时间
});
