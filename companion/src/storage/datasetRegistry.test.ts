import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * datasetRegistry.ts 测试：数据集业务编排。
 *
 * 通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离，vi.resetModules 让 db.ts/businessDb.ts/
 * datasetRegistry.ts 的模块级单例（masterDb 缓存、dbCache）每用例重置。
 *
 * macOS 上 /var 是 /private/var 软链，realpathSync 会解析。测试用 realpath 后的路径比对。
 */

let tempDir: string;
let realTempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-reg-test-"));
  realTempDir = realpathSync(tempDir);
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(async () => {
  // 关闭所有 db 连接避免 WAL 文件占用
  const { closeMasterDb } = await import("./db.js");
  const { closeAllBusinessDbs } = await import("./businessDb.js");
  closeMasterDb();
  closeAllBusinessDbs();
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadModules() {
  return await import("./datasetRegistry.js");
}

describe("resolveAndActivate", () => {
  it("首次创建新数据集：registry 有记录 + 业务 db 文件存在", async () => {
    const { resolveAndActivate } = await loadModules();
    const customDir = join(tempDir, "my-pics");
    mkdirSync(customDir, { recursive: true });
    const realCustomDir = realpathSync(customDir);

    const result = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
    });

    expect(result.created).toBe(true);
    expect(result.dataset.label).toBe(`自定义目录 ${realCustomDir}`);
    expect(result.dataset.is_active).toBe(true);
    expect(existsSync(result.dataset.db_path)).toBe(true);
    expect(result.imageStore.kind).toBe("filesystem-custom");
  });

  it("同配置复用：不新建，fingerprint 命中", async () => {
    const { resolveAndActivate, listDatasetViews } = await loadModules();
    const customDir = join(tempDir, "pics");
    mkdirSync(customDir, { recursive: true });

    const r1 = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
    });
    const r2 = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
    });

    expect(r2.created).toBe(false);
    expect(r2.dataset.id).toBe(r1.dataset.id);
    expect(listDatasetViews()).toHaveLength(1);
  });

  it("不同配置创建不同数据集", async () => {
    const { resolveAndActivate, listDatasetViews } = await loadModules();
    const dir1 = join(tempDir, "pics1");
    const dir2 = join(tempDir, "pics2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir1 },
      imageStoreKind: "filesystem-custom",
    });
    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir2 },
      imageStoreKind: "filesystem-custom",
    });

    expect(listDatasetViews()).toHaveLength(2);
  });

  it("激活后旧数据集 is_active 置 false", async () => {
    const { resolveAndActivate, listDatasetViews } = await loadModules();
    const dir1 = join(tempDir, "pics1");
    const dir2 = join(tempDir, "pics2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    const r1 = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir1 },
      imageStoreKind: "filesystem-custom",
    });
    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir2 },
      imageStoreKind: "filesystem-custom",
    });

    const views = listDatasetViews();
    const oldDataset = views.find((d) => d.id === r1.dataset.id);
    const activeDataset = views.find((d) => d.is_active);
    expect(oldDataset?.is_active).toBe(false);
    expect(activeDataset?.id).not.toBe(r1.dataset.id);
  });

  it("filesystem-default 装配默认目录 imageStore", async () => {
    const { resolveAndActivate } = await loadModules();
    const defaultDir = join(tempDir, "images");
    mkdirSync(defaultDir, { recursive: true });

    const result = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: defaultDir },
      imageStoreKind: "filesystem-default",
    });

    expect(result.imageStore.kind).toBe("filesystem-default");
  });

  it("storage_config 存储的是归一化后的目录路径", async () => {
    const { resolveAndActivate, listDatasetViews } = await loadModules();
    const customDir = join(tempDir, "pics");
    mkdirSync(customDir, { recursive: true });
    const realCustomDir = realpathSync(customDir);

    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: `${customDir}/` }, // 带尾斜杠
      imageStoreKind: "filesystem-custom",
    });

    const view = listDatasetViews()[0];
    const cfg = JSON.parse(view.storage_config);
    expect(cfg.directory).toBe(realCustomDir); // 尾斜杠被归一化掉 + 软链被解析
  });

  it("自定义 label 生效", async () => {
    const { resolveAndActivate } = await loadModules();
    const customDir = join(tempDir, "pics");
    mkdirSync(customDir, { recursive: true });

    const result = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
      label: "我的图片库",
    });

    expect(result.dataset.label).toBe("我的图片库");
  });
});

describe("getActiveImageStore", () => {
  it("无 active 返回 undefined", async () => {
    const { getActiveImageStore } = await loadModules();
    expect(await getActiveImageStore()).toBeUndefined();
  });

  it("有 active 返回对应 imageStore", async () => {
    const { resolveAndActivate, getActiveImageStore } = await loadModules();
    const customDir = join(tempDir, "pics");
    mkdirSync(customDir, { recursive: true });

    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
    });

    const active = await getActiveImageStore();
    expect(active).toBeDefined();
    expect(active!.dataset.is_active).toBe(true);
    expect(active!.imageStore.kind).toBe("filesystem-custom");
  });

  it("imageStore 真实可写（save/load 往返）", async () => {
    const { resolveAndActivate, getActiveImageStore } = await loadModules();
    const customDir = join(tempDir, "pics");
    mkdirSync(customDir, { recursive: true });

    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: customDir },
      imageStoreKind: "filesystem-custom",
    });
    const { imageStore } = (await getActiveImageStore())!;

    await imageStore.save("blob-1", Buffer.from("img-data"), "image/png");
    const loaded = await imageStore.load("blob-1");
    expect(loaded).toBeDefined();
    expect(loaded!.data.toString()).toBe("img-data");
  });
});

describe("listDatasetViews / getDatasetView", () => {
  it("listDatasetViews is_active 转 boolean", async () => {
    const { resolveAndActivate, listDatasetViews } = await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
    });

    const views = listDatasetViews();
    expect(views).toHaveLength(1);
    expect(typeof views[0].is_active).toBe("boolean");
    expect(views[0].is_active).toBe(true);
  });

  it("getDatasetView 按 id 查", async () => {
    const { resolveAndActivate, getDatasetView } = await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    const { dataset } = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
    });

    const view = getDatasetView(dataset.id);
    expect(view?.id).toBe(dataset.id);
  });

  it("getDatasetView 未命中返回 undefined", async () => {
    const { getDatasetView } = await loadModules();
    expect(getDatasetView("nonexistent")).toBeUndefined();
  });
});

describe("deleteDatasetCascade", () => {
  it("删 db 文件 + registry 记录", async () => {
    const { resolveAndActivate, deleteDatasetCascade, listDatasetViews } =
      await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    const { dataset } = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
    });
    expect(existsSync(dataset.db_path)).toBe(true);

    await deleteDatasetCascade(dataset.id);

    expect(existsSync(dataset.db_path)).toBe(false);
    expect(listDatasetViews()).toHaveLength(0);
  });

  it("删除后 getActiveImageStore 返回 undefined", async () => {
    const { resolveAndActivate, deleteDatasetCascade, getActiveImageStore } =
      await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    const { dataset } = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
    });

    await deleteDatasetCascade(dataset.id);
    expect(await getActiveImageStore()).toBeUndefined();
  });

  it("不存在 id 是 no-op", async () => {
    const { deleteDatasetCascade } = await loadModules();
    await expect(deleteDatasetCascade("nonexistent")).resolves.toBeUndefined();
  });
});

describe("renameDatasetView", () => {
  it("只改 label", async () => {
    const { resolveAndActivate, renameDatasetView, getDatasetView } =
      await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    const { dataset } = await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
      label: "原名",
    });

    renameDatasetView(dataset.id, "新名");
    expect(getDatasetView(dataset.id)?.label).toBe("新名");
  });
});

describe("ensureDefaultDataset", () => {
  it("完全无数据集时创建默认（选项 B）", async () => {
    const { ensureDefaultDataset, listDatasetViews, getActiveImageStore } =
      await loadModules();
    const dataset = await ensureDefaultDataset();

    expect(dataset.image_store_kind).toBe("filesystem-default");
    expect(dataset.is_active).toBe(true);
    expect(listDatasetViews()).toHaveLength(1);

    const active = await getActiveImageStore();
    expect(active?.imageStore.kind).toBe("filesystem-default");
  });

  it("已有 active 时 no-op（不新建）", async () => {
    const { resolveAndActivate, ensureDefaultDataset, listDatasetViews } =
      await loadModules();
    const dir = join(tempDir, "pics");
    mkdirSync(dir, { recursive: true });
    await resolveAndActivate({
      storageKind: "filesystem",
      storageConfig: { directory: dir },
      imageStoreKind: "filesystem-custom",
    });

    await ensureDefaultDataset();
    expect(listDatasetViews()).toHaveLength(1); // 没有新增
  });

  it("有数据集但无 active 时激活最近一个", async () => {
    // 直接操作 db 层模拟「有记录但 is_active=0」的状态
    const db = await import("./db.js");
    db.openMasterDb();
    db.insertDataset({
      id: "ds-orphan",
      label: "孤儿",
      storage_kind: "filesystem",
      storage_config: JSON.stringify({ directory: join(tempDir, "x") }),
      fingerprint: "fs:/x",
      db_path: join(tempDir, "datasets", "ds-orphan.db"),
      image_store_kind: "filesystem-default",
      created_at: "2026-07-01T00:00:00Z",
      activated_at: "2026-07-01T00:00:00Z",
      is_active: 0,
    });

    const { ensureDefaultDataset, getActiveImageStore } = await loadModules();
    const dataset = await ensureDefaultDataset();

    expect(dataset.id).toBe("ds-orphan");
    expect(dataset.is_active).toBe(true);
    // 注意：getActiveImageStore 会尝试装配 imageStore，孤儿记录的目录可能不存在，
    // 但 filesystem-default 用默认目录，ensureRoot 会 mkdir，应该能成功
    const active = await getActiveImageStore();
    expect(active?.dataset.id).toBe("ds-orphan");
  });
});
