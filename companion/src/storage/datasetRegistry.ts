/**
 * 数据集业务编排层。
 *
 * 连接「存储位置配置」和「底层存储实现」的中间层：
 * - resolveAndActivate：根据存储位置配置，按指纹去重创建/复用数据集并激活，
 *   装配对应的 ImageStore。对应 D7 切换流程。
 * - getActiveImageStore：路由层每次请求前调用，拿到当前数据集 + imageStore。
 * - ensureDefaultDataset：Companion 启动时保证有一个可用的默认数据集（选项 B）。
 * - deleteDatasetCascade：删数据集（关 db 连接 + 删 db 文件 + 删 registry 记录）。
 *
 * 设计要点：
 * - 业务 db 文件路径 = datasets/<id>.db，由 resolveAndActivate 创建记录时确定。
 * - imageStore 按 image_store_kind 装配，filesystem-default/custom 走 FileSystemImageStore，
 *   oss 走 OssImageStore（PR5 实现，本 PR 先抛 not-implemented）。
 * - 视图类型 DatasetView 把 is_active 的 0/1 转 boolean，回流 Web 端用。
 */
import { randomUUID } from "node:crypto";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  activateDataset,
  CONFIG_DIR,
  DATASETS_DIR,
  findDatasetByFingerprint,
  getActiveDataset,
  insertDataset,
  listDatasets,
  deleteDataset as deleteDatasetRecord,
  openMasterDb,
  renameDataset,
} from "./db.js";
import { closeBusinessDb, openBusinessDb } from "./businessDb.js";
import { computeFingerprint, normalizeDirectory } from "./fingerprint.js";
import { createFileSystemImageStore } from "./fileSystemImageStore.js";
import type { ImageStore } from "./imageStore.js";
import { StorageStoreError } from "./errors.js";
import type {
  DatasetRecord,
  DatasetView,
  FilesystemConfig,
  ImageStoreKind,
  OssConfig,
  StorageConfig,
  StorageKind,
} from "./types.js";

/** 把 DatasetRecord 的 is_active 数字转 boolean，得到视图类型。 */
function toView(record: DatasetRecord): DatasetView {
  const { is_active, ...rest } = record;
  return { ...rest, is_active: is_active === 1 };
}

/** 解析 storage_config JSON 字符串。 */
function parseStorageConfig(raw: string, storageKind: StorageKind): StorageConfig {
  try {
    const parsed = JSON.parse(raw);
    if (storageKind === "filesystem") {
      return parsed as FilesystemConfig;
    }
    return parsed as OssConfig;
  } catch (err) {
    throw new StorageStoreError(
      `数据集 storage_config 解析失败：${raw}`,
      "STORAGE_SERIALIZATION",
      { cause: err },
    );
  }
}

/**
 * 根据 imageStoreKind 装配 ImageStore。
 *
 * filesystem-default：rootDir = ~/.gpt-image-studio/images，opaqueNaming=true。
 * filesystem-custom：rootDir = 用户配置的 directory（已归一化），opaqueNaming=false。
 * oss：PR5 实现，本 PR 抛 not-implemented。
 */
function buildImageStore(
  imageStoreKind: ImageStoreKind,
  storageConfig: StorageConfig,
): ImageStore {
  if (imageStoreKind === "filesystem-default") {
    return createFileSystemImageStore({
      rootDir: defaultImagesDir(),
      opaqueNaming: true,
      kind: "filesystem-default",
    });
  }
  if (imageStoreKind === "filesystem-custom") {
    const dir = (storageConfig as FilesystemConfig).directory;
    return createFileSystemImageStore({
      rootDir: dir,
      opaqueNaming: false,
      kind: "filesystem-custom",
    });
  }
  // oss
  throw new StorageStoreError(
    "OSS 图片存储暂未实现（PR5 将填充）",
    "STORAGE_UNKNOWN",
  );
}

/** 默认图片目录（选项 B）：~/.gpt-image-studio/images。 */
function defaultImagesDir(): string {
  return join(CONFIG_DIR, "images");
}

export type ResolveInput = {
  storageKind: StorageKind;
  storageConfig: StorageConfig;
  imageStoreKind: ImageStoreKind;
  /** 用户可见名称，不传时自动生成。 */
  label?: string;
};

export type ResolveResult = {
  dataset: DatasetView;
  imageStore: ImageStore;
  /** 本次是否新建了数据集（false = 复用已有）。 */
  created: boolean;
};

/**
 * 高层 API：根据存储位置配置，解析或创建数据集并激活。
 *
 * 流程（D7 切换流程落地）：
 * 1. 算指纹。
 * 2. findDatasetByFingerprint：命中复用，未命中建记录 + 空 db。
 * 3. activateDataset（事务保证同时只有一个 active）。
 * 4. 装配 ImageStore 返回。
 */
export async function resolveAndActivate(input: ResolveInput): Promise<ResolveResult> {
  // filesystem 模式需先归一化目录（realpathSync 解软链），保证指纹稳定
  let normalizedConfig = input.storageConfig;
  if (input.storageKind === "filesystem") {
    const fsCfg = input.storageConfig as FilesystemConfig;
    normalizedConfig = {
      directory: normalizeDirectory(fsCfg.directory),
    } satisfies FilesystemConfig;
  }

  const fingerprint = computeFingerprint(input.storageKind, normalizedConfig);
  const now = new Date().toISOString();

  // 确保主 db 已打开（首次调用时建表）
  openMasterDb();

  const existing = findDatasetByFingerprint(fingerprint);
  let dataset: DatasetRecord;
  let created: boolean;

  if (existing) {
    // 复用已有数据集
    activateDataset(existing.id, now);
    dataset = { ...existing, activated_at: now, is_active: 1 };
    created = false;
  } else {
    // 新建数据集
    const id = randomUUID();
    const dbPath = join(DATASETS_DIR, `${id}.db`);
    const label = input.label ?? defaultLabel(input.imageStoreKind, normalizedConfig);
    const record: DatasetRecord = {
      id,
      label,
      storage_kind: input.storageKind,
      storage_config: JSON.stringify(normalizedConfig),
      fingerprint,
      db_path: dbPath,
      image_store_kind: input.imageStoreKind,
      created_at: now,
      activated_at: now,
      is_active: 1,
    };
    insertDataset(record);
    activateDataset(id, now);
    // 触发业务 db 文件创建（openBusinessDb 会建表 + WAL）。否则文件在首次 CRUD 前不存在。
    openBusinessDb(dbPath);
    dataset = record;
    created = true;
  }

  const imageStore = buildImageStore(input.imageStoreKind, normalizedConfig);
  return { dataset: toView(dataset), imageStore, created };
}

/** 生成默认 label。 */
function defaultLabel(kind: ImageStoreKind, config: StorageConfig): string {
  if (kind === "filesystem-default") return "默认目录";
  if (kind === "filesystem-custom") {
    return `自定义目录 ${(config as FilesystemConfig).directory}`;
  }
  const oss = config as OssConfig;
  return `OSS ${oss.bucket}`;
}

export type ActiveImageStore = {
  dataset: DatasetView;
  imageStore: ImageStore;
};

/**
 * 获取当前激活数据集的 ImageStore。
 *
 * 路由层每次请求前调用：
 * - 有 active → 返回 { dataset, imageStore }。
 * - 无 active → 返回 undefined（首次启动场景，ensureDefaultDataset 会兜底）。
 */
export async function getActiveImageStore(): Promise<ActiveImageStore | undefined> {
  openMasterDb();
  const active = getActiveDataset();
  if (!active) return undefined;
  const config = parseStorageConfig(active.storage_config, active.storage_kind);
  const imageStore = buildImageStore(active.image_store_kind, config);
  return { dataset: toView(active), imageStore };
}

/** 列出全部数据集（视图类型）。 */
export function listDatasetViews(): DatasetView[] {
  openMasterDb();
  return listDatasets().map(toView);
}

/** 按主键查数据集（视图类型）。 */
export function getDatasetView(id: string): DatasetView | undefined {
  openMasterDb();
  const record = listDatasets().find((d) => d.id === id);
  return record ? toView(record) : undefined;
}

/**
 * 删除数据集（级联）：
 * 1. 关闭对应业务 db 连接（避免文件占用）。
 * 2. 删业务 db 文件（+ WAL/-shm 副产物）。
 * 3. 删 registry 记录。
 *
 * 注意：不删图片文件——图片文件可能被多个数据集引用（虽然指纹去重使这不太可能），
 * 且图片目录可能是用户自选的（选项 A），不应由 Companion 删除。
 * 图片清理留给未来的「孤儿图片回收」机制。
 */
export async function deleteDatasetCascade(id: string): Promise<void> {
  openMasterDb();
  const record = listDatasets().find((d) => d.id === id);
  if (!record) return; // 不存在是 no-op

  // 关闭业务 db 连接
  closeBusinessDb(record.db_path);

  // 删 db 文件 + WAL/-shm 副产物
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${record.db_path}${suffix}`;
    if (existsSync(f)) {
      try {
        rmSync(f, { force: true });
      } catch {
        // 删除失败不阻断（可能被占用），记录即可
      }
    }
  }

  // 删 registry 记录
  deleteDatasetRecord(id);
}

/**
 * 重命名数据集（只改 label）。
 */
export function renameDatasetView(id: string, label: string): void {
  openMasterDb();
  renameDataset(id, label);
}

/**
 * Companion 启动时保证有一个可用的默认数据集（选项 B）。
 *
 * - 无任何数据集 → 创建选项 B 默认数据集并激活。
 * - 有数据集但无 active → 激活最近一个。
 * - 有 active → no-op。
 *
 * 这样首次启动切到 Companion 模式立即可用，无需用户先配置。
 */
export async function ensureDefaultDataset(): Promise<DatasetView> {
  openMasterDb();
  const active = getActiveDataset();
  if (active) return toView(active);

  const all = listDatasets();
  if (all.length > 0) {
    // 有数据集但没 active，激活最近一个
    const latest = all[0]; // listDatasets 已按 activated_at 倒序
    activateDataset(latest.id, new Date().toISOString());
    return toView({ ...latest, is_active: 1 });
  }

  // 完全没数据集，创建默认（选项 B）
  const result = await resolveAndActivate({
    storageKind: "filesystem",
    storageConfig: { directory: defaultImagesDir() },
    imageStoreKind: "filesystem-default",
    label: "默认目录",
  });
  return result.dataset;
}
