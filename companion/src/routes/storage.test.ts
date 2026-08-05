import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * /storage/* 路由集成测试。
 *
 * 真实 Fastify（app.inject 模拟 HTTP）+ 真实 SQLite（tempDir 隔离），
 * 不 mock 存储层——验证「HTTP 请求 → 存储读写 → HTTP 响应」完整链路。
 *
 * 鉴权：storageRoutes 在 authMiddleware 之后注册，需要 bearer accessKey。
 * 测试里调 loadOrCreateAccessKey() 生成密钥，注入 Authorization 头。
 */

let tempDir: string;
let realTempDir: string;
let accessKey: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-storage-route-test-"));
  realTempDir = realpathSync(tempDir);
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(async () => {
  // 关闭 db 连接避免 WAL 占用
  const { closeMasterDb } = await import("../storage/db.js");
  const { closeAllBusinessDbs } = await import("../storage/businessDb.js");
  closeMasterDb();
  closeAllBusinessDbs();
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function makeApp(): Promise<FastifyInstance> {
  const { storageRoutes } = await import("./storage.js");
  const { authMiddleware } = await import("../middleware/auth.js");
  const { loadOrCreateAccessKey } = await import("../accessKey.js");
  accessKey = loadOrCreateAccessKey();
  const app: FastifyInstance = Fastify();
  // local 模式：accessKey 验证（阶段二行为），req.user.userId='__local__'
  await authMiddleware(app, { mode: "local" });
  await app.register(storageRoutes);
  return app;
}

/** 带 bearer token 的 inject 选项。合并 headers 而非覆盖（multipart 需同时带 auth + content-type）。 */
function auth(url: string, opts: Record<string, unknown> = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  return {
    method: "GET" as const,
    url,
    headers: { authorization: `Bearer ${accessKey}`, ...(extraHeaders as Record<string, string>) },
    ...rest,
  };
}

/** 先激活一个默认数据集（选项 B），让后续 CRUD 有 active dataset。 */
async function activateDefault(app: FastifyInstance): Promise<void> {
  const defaultDir = join(tempDir, "images");
  mkdirSync(defaultDir, { recursive: true });
  await app.inject(
    auth("/storage/datasets/activate", {
      method: "POST",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: defaultDir },
        imageStoreKind: "filesystem-default",
      },
    }),
  );
}

describe("鉴权", () => {
  it("缺 bearer 返回 401", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/storage/datasets" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("错误 bearer 返回 401", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/storage/datasets",
      headers: { authorization: "Bearer wrong-key" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("正确 bearer 放行", async () => {
    const app = await makeApp();
    const res = await app.inject(auth("/storage/datasets"));
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("数据集管理", () => {
  it("GET /storage/datasets 初始为空", async () => {
    const app = await makeApp();
    const res = await app.inject(auth("/storage/datasets"));
    expect(res.statusCode).toBe(200);
    expect(res.json().datasets).toEqual([]);
    await app.close();
  });

  it("POST /storage/datasets/activate 创建并激活默认数据集", async () => {
    const app = await makeApp();
    const defaultDir = join(tempDir, "images");
    mkdirSync(defaultDir, { recursive: true });
    const res = await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: defaultDir },
          imageStoreKind: "filesystem-default",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.dataset.is_active).toBe(true);
    expect(body.dataset.image_store_kind).toBe("filesystem-default");
    await app.close();
  });

  it("POST activate filesystem-default 允许空 directory（Companion 回填默认目录）", async () => {
    const app = await makeApp();
    mkdirSync(join(tempDir, "images"), { recursive: true });
    const res = await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: "" }, // 前端切回默认目录时传空串占位
          imageStoreKind: "filesystem-default",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().dataset.image_store_kind).toBe("filesystem-default");
    await app.close();
  });

  it("POST activate filesystem-custom 空 directory 仍返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: "" },
          imageStoreKind: "filesystem-custom",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /storage/datasets/active 无激活返回 404", async () => {
    const app = await makeApp();
    const res = await app.inject(auth("/storage/datasets/active"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /storage/datasets/active 有激活返回数据集", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/datasets/active"));
    expect(res.statusCode).toBe(200);
    expect(res.json().dataset.is_active).toBe(true);
    await app.close();
  });

  it("切换数据集：第二次 activate 后旧的失活", async () => {
    const app = await makeApp();
    const dir1 = join(tempDir, "pics1");
    const dir2 = join(tempDir, "pics2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: dir1 },
          imageStoreKind: "filesystem-custom",
        },
      }),
    );
    await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: dir2 },
          imageStoreKind: "filesystem-custom",
        },
      }),
    );
    const res = await app.inject(auth("/storage/datasets"));
    const datasets = res.json().datasets;
    const active = datasets.find((d: { is_active: boolean }) => d.is_active);
    expect(active).toBeDefined();
    // dir2 是后激活的，其指纹基于 realpath 后的路径
    const dir2Fp = `fs:${realpathSync(dir2)}`;
    expect(active.fingerprint).toBe(dir2Fp);
    await app.close();
  });

  it("filesystem-custom 非法目录返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: "relative/path" },
          imageStoreKind: "filesystem-custom",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("绝对路径");
    await app.close();
  });

  it("storageKind/imageStoreKind 不一致返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject(
      auth("/storage/datasets/activate", {
        method: "POST",
        payload: {
          storageKind: "filesystem",
          storageConfig: { directory: "/tmp" },
          imageStoreKind: "oss",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE /storage/datasets/:id 删除数据集", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const list = (await app.inject(auth("/storage/datasets"))).json().datasets;
    const id = list[0].id;
    const res = await app.inject(
      auth(`/storage/datasets/${id}`, { method: "DELETE" }),
    );
    expect(res.statusCode).toBe(200);
    const after = (await app.inject(auth("/storage/datasets"))).json().datasets;
    expect(after).toHaveLength(0);
    await app.close();
  });

  it("PATCH /storage/datasets/:id 重命名", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const list = (await app.inject(auth("/storage/datasets"))).json().datasets;
    const id = list[0].id;
    await app.inject(
      auth(`/storage/datasets/${id}`, {
        method: "PATCH",
        payload: { label: "新名字" },
      }),
    );
    const after = (await app.inject(auth("/storage/datasets"))).json().datasets;
    expect(after[0].label).toBe("新名字");
    await app.close();
  });
});

describe("业务表 CRUD", () => {
  beforeEach(async () => {
    // 共用一个激活了默认数据集的 app（每个 it 自己建，这里只是占位说明依赖）
  });

  it("无 active dataset 时 CRUD 返回 503", async () => {
    const app = await makeApp();
    const res = await app.inject(auth("/storage/messages"));
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("GET 空表返回空数组", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/messages"));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    await app.close();
  });

  it("PUT + GET 往返一致", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/messages/m1", {
        method: "PUT",
        payload: { id: "m1", text: "hello", n: 42 },
      }),
    );
    const res = await app.inject(auth("/storage/messages/m1"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "m1", text: "hello", n: 42 });
    await app.close();
  });

  it("GET 不存在返回 404", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/messages/nope"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("PUT 是 upsert", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/messages/m1", { method: "PUT", payload: { v: 1 } }),
    );
    await app.inject(
      auth("/storage/messages/m1", { method: "PUT", payload: { v: 2 } }),
    );
    const res = await app.inject(auth("/storage/messages/m1"));
    expect(res.json()).toEqual({ v: 2 });
    await app.close();
  });

  it("DELETE 单条", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/messages/m1", { method: "PUT", payload: { v: 1 } }),
    );
    await app.inject(
      auth("/storage/messages/m1", { method: "DELETE" }),
    );
    const res = await app.inject(auth("/storage/messages/m1"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE 清空表", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/messages/m1", { method: "PUT", payload: { v: 1 } }),
    );
    await app.inject(
      auth("/storage/messages/m2", { method: "PUT", payload: { v: 2 } }),
    );
    await app.inject(auth("/storage/messages", { method: "DELETE" }));
    const res = await app.inject(auth("/storage/messages"));
    expect(res.json().data).toEqual([]);
    await app.close();
  });

  it("非法表名返回 400", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/malicious"));
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("7 张表独立隔离", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const tables = [
      "conversations", "messages", "imageAssets", "imageBlobs",
      "settings", "conversationDrafts", "analyticsEvents",
    ];
    for (const t of tables) {
      await app.inject(
        auth(`/storage/${t}/k1`, { method: "PUT", payload: { table: t } }),
      );
    }
    for (const t of tables) {
      const res = await app.inject(auth(`/storage/${t}`));
      expect(res.json().data).toEqual([{ table: t }]);
    }
    await app.close();
  });
});

describe("图片二进制", () => {
  it("POST + GET 往返（multipart）", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const boundary = "----testboundary";
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="img.png"\r\n` +
        `Content-Type: image/png\r\n\r\n` +
        `png-bytes-data\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="mimeType"\r\n\r\n` +
        `image/png\r\n` +
        `--${boundary}--\r\n`,
    );
    const uploadRes = await app.inject(
      auth("/storage/blobs/blob-1", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      }),
    );
    expect(uploadRes.statusCode).toBe(200);
    expect(uploadRes.json().mimeType).toBe("image/png");

    const getRes = await app.inject(auth("/storage/blobs/blob-1"));
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers["content-type"]).toBe("image/png");
    expect(getRes.body).toBe("png-bytes-data");
    // blobKey 内容不可变 → 长缓存 + immutable；带鉴权按用户隔离 → private
    expect(getRes.headers["cache-control"]).toBe(
      "private, max-age=31536000, immutable",
    );
    await app.close();
  });

  it("GET 不存在图片返回 404", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/blobs/nope"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE 图片", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const boundary = "----b";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="mimeType"\r\n\r\nimage/png\r\n--${boundary}--\r\n`,
    );
    await app.inject(
      auth("/storage/blobs/k1", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      }),
    );
    await app.inject(auth("/storage/blobs/k1", { method: "DELETE" }));
    const res = await app.inject(auth("/storage/blobs/k1"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /size 返回字节大小", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const boundary = "----b";
    const payload = "hello";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\n${payload}\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="mimeType"\r\n\r\nimage/png\r\n--${boundary}--\r\n`,
    );
    await app.inject(
      auth("/storage/blobs/k1", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      }),
    );
    const res = await app.inject(auth("/storage/blobs/k1/size"));
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBe(payload.length);
    await app.close();
  });
});

describe("配置读写", () => {
  it("PUT + GET 配置往返", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/config/companionUrl", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify("http://127.0.0.1:19750"),
      }),
    );
    const res = await app.inject(auth("/storage/config/companionUrl"));
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe("http://127.0.0.1:19750");
    await app.close();
  });

  it("GET 不存在配置返回 404", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/config/nope"));
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("配置存对象", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/config/obj", {
        method: "PUT",
        payload: { a: 1, b: { c: 2 } },
      }),
    );
    const res = await app.inject(auth("/storage/config/obj"));
    expect(res.json().value).toEqual({ a: 1, b: { c: 2 } });
    await app.close();
  });
});

describe("容量估算", () => {
  it("空数据集 imageBytes=0, metadataBytes=0", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/usage"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imageBytes: 0, metadataBytes: 0 });
    await app.close();
  });

  it("写入数据后容量增长", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await app.inject(
      auth("/storage/messages/m1", {
        method: "PUT",
        payload: { id: "m1", text: "some content here" },
      }),
    );
    const res = await app.inject(auth("/storage/usage"));
    expect(res.json().metadataBytes).toBeGreaterThan(0);
    await app.close();
  });

  it("写入图片后 imageBytes 增长", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const boundary = "----b";
    const payload = "image-bytes";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\n${payload}\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="mimeType"\r\n\r\nimage/png\r\n--${boundary}--\r\n`,
    );
    await app.inject(
      auth("/storage/blobs/k1", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      }),
    );
    const res = await app.inject(auth("/storage/usage"));
    expect(res.json().imageBytes).toBe(payload.length);
    await app.close();
  });
});

describe("分页查询（server 模式分页 PR-a）", () => {
  /** 造 n 条消息（createdAt 逐分钟递增，conversationId 可指定）。 */
  async function seedMessages(
    app: FastifyInstance,
    n: number,
    conversationId = "c1",
    keyPrefix = "m",
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      const key = `${keyPrefix}${String(i).padStart(3, "0")}`;
      await app.inject(
        auth(`/storage/messages/${key}`, {
          method: "PUT",
          payload: {
            id: key,
            conversationId,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          },
        }),
      );
    }
  }

  it("无 query 参数：保持旧契约全量返回 { data }（无 nextCursor/total）", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await seedMessages(app, 3);
    const res = await app.inject(auth("/storage/messages"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body).not.toHaveProperty("nextCursor");
    expect(body).not.toHaveProperty("total");
    await app.close();
  });

  it("?limit= 分页返回 { data, nextCursor, total }，DESC 序", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await seedMessages(app, 3);
    const res = await app.inject(auth("/storage/messages?limit=2"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(["m002", "m001"]);
    expect(typeof body.nextCursor).toBe("string");
    expect(body.total).toBe(3);
    await app.close();
  });

  it("nextCursor 翻页：第二页取到剩余记录且 nextCursor=null", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await seedMessages(app, 3);
    const page1 = (await app.inject(auth("/storage/messages?limit=2"))).json();
    const res2 = await app.inject(
      auth(`/storage/messages?limit=2&before=${encodeURIComponent(page1.nextCursor)}`),
    );
    const page2 = res2.json();
    expect(page2.data.map((m: { id: string }) => m.id)).toEqual(["m000"]);
    expect(page2.nextCursor).toBeNull();
    expect(page2.total).toBe(3);
    await app.close();
  });

  it("conversationId 过滤：只回该会话消息，total 只算过滤后", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await seedMessages(app, 3, "c1", "a");
    await seedMessages(app, 2, "c2", "b");
    const res = await app.inject(auth("/storage/messages?conversationId=c1&limit=10"));
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(
      body.data.every((m: { conversationId: string }) => m.conversationId === "c1"),
    ).toBe(true);
    expect(body.total).toBe(3);
    await app.close();
  });

  it("只有 conversationId 没有 limit：走分页模式（默认页大小），不是全量", async () => {
    const app = await makeApp();
    await activateDefault(app);
    await seedMessages(app, 3);
    const res = await app.inject(auth("/storage/messages?conversationId=c1"));
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body).toHaveProperty("nextCursor", null);
    expect(body).toHaveProperty("total", 3);
    await app.close();
  });

  it("limit 非法（0 / 超上限 / 非数字）返回 400", async () => {
    const app = await makeApp();
    await activateDefault(app);
    for (const bad of ["0", "-1", "201", "abc"]) {
      const res = await app.inject(auth(`/storage/messages?limit=${bad}`));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("STORAGE_INVALID_QUERY");
    }
    await app.close();
  });

  it("before 是非法游标返回 400", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/messages?limit=10&before=garbage"));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("STORAGE_INVALID_CURSOR");
    await app.close();
  });

  it("不支持分页的表（settings）传 limit 返回 400", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/settings?limit=10"));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("STORAGE_INVALID_QUERY");
    await app.close();
  });

  it("conversations 传 conversationId 返回 400", async () => {
    const app = await makeApp();
    await activateDefault(app);
    const res = await app.inject(auth("/storage/conversations?conversationId=c1"));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("STORAGE_INVALID_QUERY");
    await app.close();
  });

  it("imageAssets 支持 conversationId 过滤 + createdAt DESC 分页", async () => {
    const app = await makeApp();
    await activateDefault(app);
    for (let i = 0; i < 3; i++) {
      await app.inject(
        auth(`/storage/imageAssets/img${i}`, {
          method: "PUT",
          payload: {
            id: `img${i}`,
            conversationId: i === 2 ? "c2" : "c1",
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
          },
        }),
      );
    }
    const res = await app.inject(auth("/storage/imageAssets?conversationId=c1&limit=10"));
    const body = res.json();
    expect(body.data.map((a: { id: string }) => a.id)).toEqual(["img1", "img0"]);
    expect(body.total).toBe(2);
    await app.close();
  });
});
