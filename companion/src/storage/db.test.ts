import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 主 db（studio.db）的单元测试。
 *
 * 每个用例用独立的临时目录（通过 GPT_IMAGE_STUDIO_CONFIG_DIR 隔离），
 * 不碰真实的 ~/.gpt-image-studio。沿用 credentials.test.ts 的隔离模式。
 *
 * vi.resetModules() + 动态 import 保证 db.ts 的模块级常量（CONFIG_DIR、DATASETS_DIR、
 * masterDb 缓存）每个用例重新求值。
 */

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gis-masterdb-test-"));
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  // 先关连接再删目录，否则 WAL 文件占用导致 rmSync 报错（macOS/Windows）
  // 动态 import 拿到的 closeMasterDb 关闭当前用例的连接
  delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

async function loadModules() {
  const db = await import("./db.js");
  return db;
}

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ds-1",
    label: "默认数据集",
    storage_kind: "filesystem" as const,
    storage_config: JSON.stringify({ directory: "/tmp/pics" }),
    fingerprint: "fs:/tmp/pics",
    db_path: join(tempDir, "datasets", "ds-1.db"),
    image_store_kind: "filesystem-default" as const,
    created_at: "2026-07-27T00:00:00.000Z",
    activated_at: "2026-07-27T00:00:00.000Z",
    is_active: 0 as 0 | 1,
    ...overrides,
  };
}

describe("openMasterDb", () => {
  it("首次打开创建 studio.db 和 datasets 目录（权限 0700）", async () => {
    const { openMasterDb, closeMasterDb, CONFIG_DIR, DATASETS_DIR } =
      await loadModules();
    openMasterDb();
    closeMasterDb();
    expect(existsSync(join(CONFIG_DIR, "studio.db"))).toBe(true);
    expect(existsSync(DATASETS_DIR)).toBe(true);
    const dirStat = statSync(CONFIG_DIR);
    // macOS/Linux 权限位，0700 = 0o700
    expect((dirStat.mode & 0o777)).toBe(0o700);
  });

  it("二次调用返回同一实例（单例缓存）", async () => {
    const { openMasterDb, closeMasterDb } = await loadModules();
    const a = openMasterDb();
    const b = openMasterDb();
    expect(a).toBe(b);
    closeMasterDb();
  });

  it("closeMasterDb 后再 open 返回新实例", async () => {
    const { openMasterDb, closeMasterDb } = await loadModules();
    const a = openMasterDb();
    closeMasterDb();
    const b = openMasterDb();
    expect(a).not.toBe(b);
    closeMasterDb();
  });

  it("user_version 设置为 MASTER_DB_VERSION", async () => {
    const { openMasterDb, closeMasterDb } = await loadModules();
    const db = openMasterDb();
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(1);
    closeMasterDb();
  });

  it("dataset_registry 表存在且有正确字段", async () => {
    const { openMasterDb, closeMasterDb } = await loadModules();
    const db = openMasterDb();
    const cols = db.prepare("PRAGMA table_info(dataset_registry)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id", "label", "storage_kind", "storage_config", "fingerprint",
        "db_path", "image_store_kind", "created_at", "activated_at", "is_active",
      ]),
    );
    closeMasterDb();
  });
});

describe("dataset_registry CRUD", () => {
  it("insertDataset + getDataset 往返一致", async () => {
    const { openMasterDb, insertDataset, getDataset, closeMasterDb } =
      await loadModules();
    const record = makeRecord();
    insertDataset(record);
    const got = getDataset("ds-1");
    expect(got).toEqual(record);
    closeMasterDb();
  });

  it("getDataset 未命中返回 undefined", async () => {
    const { getDataset, closeMasterDb } = await loadModules();
    expect(getDataset("nonexistent")).toBeUndefined();
    closeMasterDb();
  });

  it("findDatasetByFingerprint 命中", async () => {
    const { insertDataset, findDatasetByFingerprint, closeMasterDb } =
      await loadModules();
    insertDataset(makeRecord());
    const got = findDatasetByFingerprint("fs:/tmp/pics");
    expect(got?.id).toBe("ds-1");
    closeMasterDb();
  });

  it("findDatasetByFingerprint 未命中返回 undefined", async () => {
    const { findDatasetByFingerprint, closeMasterDb } = await loadModules();
    expect(findDatasetByFingerprint("oss:x:y:z")).toBeUndefined();
    closeMasterDb();
  });

  it("fingerprint 唯一约束：重复插入抛错", async () => {
    const { insertDataset, closeMasterDb } = await loadModules();
    insertDataset(makeRecord({ id: "ds-1" }));
    expect(() => insertDataset(makeRecord({ id: "ds-2" }))).toThrow();
    closeMasterDb();
  });

  it("listDatasets 返回全部，按 activated_at 倒序", async () => {
    const { insertDataset, listDatasets, closeMasterDb } = await loadModules();
    insertDataset(makeRecord({ id: "ds-1", activated_at: "2026-07-01T00:00:00Z" }));
    insertDataset(makeRecord({ id: "ds-2", activated_at: "2026-07-27T00:00:00Z", fingerprint: "fs:/other" }));
    const list = listDatasets();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("ds-2"); // 更近期的在前
    expect(list[1].id).toBe("ds-1");
    closeMasterDb();
  });

  it("activateDataset 事务原子：激活目标、其余置 0、更新 activated_at", async () => {
    const { insertDataset, activateDataset, getDataset, getActiveDataset, closeMasterDb } =
      await loadModules();
    insertDataset(makeRecord({ id: "ds-1", is_active: 1, activated_at: "2026-07-01T00:00:00Z" }));
    insertDataset(makeRecord({ id: "ds-2", is_active: 0, fingerprint: "fs:/b", activated_at: "2026-07-02T00:00:00Z" }));

    activateDataset("ds-2", "2026-07-27T10:00:00Z");

    expect(getDataset("ds-1")?.is_active).toBe(0);
    expect(getDataset("ds-2")?.is_active).toBe(1);
    expect(getDataset("ds-2")?.activated_at).toBe("2026-07-27T10:00:00Z");
    expect(getActiveDataset()?.id).toBe("ds-2");
    closeMasterDb();
  });

  it("activateDataset 对不存在的 id 不报错（UPDATE 0 行）", async () => {
    const { activateDataset, closeMasterDb } = await loadModules();
    expect(() => activateDataset("nonexistent", "2026-07-27T00:00:00Z")).not.toThrow();
    closeMasterDb();
  });

  it("getActiveDataset 无 active 返回 undefined", async () => {
    const { getActiveDataset, closeMasterDb } = await loadModules();
    expect(getActiveDataset()).toBeUndefined();
    closeMasterDb();
  });

  it("getActiveDataset 多条 active 返回 activated_at 最大者", async () => {
    const { insertDataset, getActiveDataset, closeMasterDb } = await loadModules();
    // 理论上同时只该有一条 active，但防御性测试
    insertDataset(makeRecord({ id: "ds-1", is_active: 1, activated_at: "2026-07-01T00:00:00Z" }));
    insertDataset(makeRecord({ id: "ds-2", is_active: 1, fingerprint: "fs:/b", activated_at: "2026-07-27T00:00:00Z" }));
    expect(getActiveDataset()?.id).toBe("ds-2");
    closeMasterDb();
  });

  it("deleteDataset 删除记录", async () => {
    const { insertDataset, deleteDataset, getDataset, closeMasterDb } =
      await loadModules();
    insertDataset(makeRecord());
    deleteDataset("ds-1");
    expect(getDataset("ds-1")).toBeUndefined();
    closeMasterDb();
  });

  it("deleteDataset 不存在 id 是 no-op", async () => {
    const { deleteDataset, closeMasterDb } = await loadModules();
    expect(() => deleteDataset("nonexistent")).not.toThrow();
    closeMasterDb();
  });

  it("renameDataset 只改 label", async () => {
    const { insertDataset, renameDataset, getDataset, closeMasterDb } =
      await loadModules();
    insertDataset(makeRecord({ label: "原名" }));
    renameDataset("ds-1", "新名");
    expect(getDataset("ds-1")?.label).toBe("新名");
    closeMasterDb();
  });
});
