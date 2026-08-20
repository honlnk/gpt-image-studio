import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * admin.ts 数据集管理端点测试：/admin/api/datasets（loopbackGuard，不走 bearer）。
 *
 * app.inject 默认无 Origin 头，loopbackGuard 视为本机直连放行。
 * 通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离配置目录，vi.resetModules 重置模块级 db 单例。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-admin-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(async () => {
  const { closeMasterDb } = await import("../storage/db.js");
  const { closeAllBusinessDbs } = await import("../storage/businessDb.js");
  closeMasterDb();
  closeAllBusinessDbs();
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function makeApp(): Promise<FastifyInstance> {
  const { default: Fastify } = await import("fastify");
  const { adminRoutes } = await import("./admin.js");
  const app: FastifyInstance = Fastify();
  await app.register(adminRoutes);
  return app;
}

describe("/admin/api/datasets", () => {
  it("GET 初始返回空列表", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/admin/api/datasets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().datasets).toEqual([]);
    await app.close();
  });

  it("POST activate filesystem-default 空 directory 由 Companion 回填默认目录", async () => {
    const app = await makeApp();
    mkdirSync(join(tempDir, "images"), { recursive: true });
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/datasets/activate",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: "" },
        imageStoreKind: "filesystem-default",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.dataset.is_active).toBe(true);
    expect(body.dataset.image_store_kind).toBe("filesystem-default");
    await app.close();
  });

  it("POST activate filesystem-custom 空 directory 返回 400", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/datasets/activate",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: "" },
        imageStoreKind: "filesystem-custom",
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("切到自定义目录再切回默认：复用原默认数据集（created=false、id 相同）", async () => {
    const app = await makeApp();
    const customDir = join(tempDir, "pics");
    mkdirSync(join(tempDir, "images"), { recursive: true });
    mkdirSync(customDir, { recursive: true });

    const def = await app.inject({
      method: "POST",
      url: "/admin/api/datasets/activate",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: "" },
        imageStoreKind: "filesystem-default",
      },
    });
    const defaultId = def.json().dataset.id;

    await app.inject({
      method: "POST",
      url: "/admin/api/datasets/activate",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: customDir },
        imageStoreKind: "filesystem-custom",
      },
    });

    const back = await app.inject({
      method: "POST",
      url: "/admin/api/datasets/activate",
      payload: {
        storageKind: "filesystem",
        storageConfig: { directory: "" },
        imageStoreKind: "filesystem-default",
      },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().created).toBe(false);
    expect(back.json().dataset.id).toBe(defaultId);
    await app.close();
  });
});

describe("resolveAdminDir", () => {
  afterEach(() => {
    delete process.env.COMPANION_ADMIN_DIR;
  });

  it("默认回到包布局的 admin 目录（dist/routes → ../admin）", async () => {
    const { resolveAdminDir } = await import("./admin.js");
    const dir = resolveAdminDir();
    expect(dir.endsWith("admin")).toBe(true);
    // 不是相对路径拼出来的当前目录 admin
    expect(dir.split("src")[0].length).toBeGreaterThan(0);
  });

  it("COMPANION_ADMIN_DIR 覆盖时解析为绝对路径（供 sidecar 资源目录使用）", async () => {
    process.env.COMPANION_ADMIN_DIR = "relative/resources/admin";
    const { resolveAdminDir } = await import("./admin.js");
    const { resolve } = await import("node:path");
    expect(resolveAdminDir()).toBe(resolve("relative/resources/admin"));
  });

  it("空白的 COMPANION_ADMIN_DIR 被忽略", async () => {
    process.env.COMPANION_ADMIN_DIR = "   ";
    const { resolveAdminDir } = await import("./admin.js");
    expect(resolveAdminDir().endsWith("admin")).toBe(true);
  });
});
