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
import { rmSync, existsSync, mkdirSync } from "node:fs";
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
  LOCAL_USER_ID,
  getUser,
  insertUser,
  updateUserDisplayName,
} from "./db.js";
import { closeBusinessDb, openBusinessDb } from "./businessDb.js";
import { computeFingerprint, normalizeDirectory } from "./fingerprint.js";
import { createFileSystemImageStore } from "./fileSystemImageStore.js";
import { createOssImageStore, createStsOssImageStore } from "./ossImageStore.js";
import { loadOssCredentials } from "./ossCredentials.js";
import { getStsCredentials } from "./stsCredentials.js";
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
 * oss + local 模式（userId='__local__'）：从 oss-credentials.json 读长期 AK。
 * oss + server 模式：用 STS 临时凭证（D11），调宿主签发接口拿短期凭证。
 */
function buildImageStore(
  imageStoreKind: ImageStoreKind,
  storageConfig: StorageConfig,
  userId: string = LOCAL_USER_ID,
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
  const ossCfg = storageConfig as OssConfig;
  if (userId !== LOCAL_USER_ID) {
    // server 模式：STS 临时凭证（D11）。prefix 由宿主 STS 响应限定（忽略 ossCfg.prefix）。
    return createStsOssImageStore({
      getUserId: () => userId,
      getStsCredentials: (uid) => getStsCredentials(uid),
    });
  }
  // local 模式：从 oss-credentials.json 读长期 AK（阶段二行为）
  const ossCreds = loadOssCredentials();
  if (!ossCreds) {
    throw new StorageStoreError(
      "OSS 凭据未配置，请先在管理页配置 OSS",
      "STORAGE_UNKNOWN",
    );
  }
  return createOssImageStore({
    endpoint: ossCreds.endpoint,
    bucket: ossCreds.bucket,
    accessKeyId: ossCreds.accessKeyId,
    accessKeySecret: ossCreds.accessKeySecret,
    prefix: ossCfg.prefix ?? "gpt-image-studio",
  });
}

/** 默认图片目录（选项 B）：~/.gpt-image-studio/images。 */
function defaultImagesDir(): string {
  return join(CONFIG_DIR, "images");
}

/**
 * 计算指定用户的业务 db 存放目录。
 *
 * - local 模式（userId='__local__'）：<CONFIG_DIR>/datasets（阶段二结构，零破坏）。
 * - server 模式：<CONFIG_DIR>/users/<userId>/datasets（多租户物理隔离）。
 */
function datasetsDirForUser(userId: string): string {
  if (userId === LOCAL_USER_ID) return DATASETS_DIR;
  return join(CONFIG_DIR, "users", userId, "datasets");
}

/**
 * 懒创建用户：首次见到 userId 时建 user 记录 + 建用户数据目录。
 *
 * JWT 中间件验证通过后调用（server 模式）。已存在的用户只更新 display_name。
 * local 模式不调用（虚拟用户 '__local__' 不需要 user 记录）。
 */
export function ensureUser(userId: string, displayName?: string): void {
  if (userId === LOCAL_USER_ID) return; // local 虚拟用户不建记录
  openMasterDb();
  const existing = getUser(userId);
  if (existing) {
    if (displayName && displayName !== existing.display_name) {
      updateUserDisplayName(userId, displayName);
    }
    return;
  }
  insertUser({
    id: userId,
    display_name: displayName ?? "",
    created_at: new Date().toISOString(),
  });
  // 建用户数据目录（业务 db 存放处）
  mkdirSync(datasetsDirForUser(userId), { recursive: true, mode: 0o700 });
}

export type ResolveInput = {
  storageKind: StorageKind;
  storageConfig: StorageConfig;
  imageStoreKind: ImageStoreKind;
  /** 用户可见名称，不传时自动生成。 */
  label?: string;
  /** 所属用户 id（多租户，local 模式默认 '__local__'）。 */
  userId?: string;
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
 * 流程（D7 切换流程落地，阶段三加 userId 维度）：
 * 1. 算指纹。
 * 2. findDatasetByFingerprint(fingerprint, userId)：命中复用，未命中建记录 + 空 db。
 * 3. activateDataset（事务保证该用户同时只有一个 active）。
 * 4. 装配 ImageStore 返回。
 *
 * 多租户：业务 db 路径按 userId 隔离（users/<userId>/datasets/<id>.db）。
 */
export async function resolveAndActivate(input: ResolveInput): Promise<ResolveResult> {
  const userId = input.userId ?? LOCAL_USER_ID;

  // filesystem 模式需先归一化目录（realpathSync 解软链），保证指纹稳定
  let normalizedConfig = input.storageConfig;
  if (input.storageKind === "filesystem") {
    // filesystem-default 的目录由 Companion 决定（前端传空串占位），
    // 必须与 ensureDefaultDataset 一致，否则指纹不同会新建数据集而非复用默认数据集。
    const fsCfg = input.storageConfig as FilesystemConfig;
    normalizedConfig = {
      directory: normalizeDirectory(
        input.imageStoreKind === "filesystem-default"
          ? defaultImagesDir()
          : fsCfg.directory,
      ),
    } satisfies FilesystemConfig;
  }

  const fingerprint = computeFingerprint(input.storageKind, normalizedConfig);
  const now = new Date().toISOString();

  // 确保主 db 已打开（首次调用时建表）+ 用户目录就绪
  openMasterDb();
  if (userId !== LOCAL_USER_ID) {
    mkdirSync(datasetsDirForUser(userId), { recursive: true, mode: 0o700 });
  }

  const existing = findDatasetByFingerprint(fingerprint, userId);
  let dataset: DatasetRecord;
  let created: boolean;

  if (existing) {
    // 复用已有数据集
    activateDataset(existing.id, now, userId);
    dataset = { ...existing, activated_at: now, is_active: 1 };
    created = false;
  } else {
    // 新建数据集
    const id = randomUUID();
    const dbPath = join(datasetsDirForUser(userId), `${id}.db`);
    const label = input.label ?? defaultLabel(input.imageStoreKind, normalizedConfig);
    const record: DatasetRecord = {
      id,
      user_id: userId,
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
    activateDataset(id, now, userId);
    // 触发业务 db 文件创建（openBusinessDb 会建表 + WAL）。否则文件在首次 CRUD 前不存在。
    openBusinessDb(dbPath);
    dataset = record;
    created = true;
  }

  const imageStore = buildImageStore(input.imageStoreKind, normalizedConfig, userId);
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
 * 获取指定用户当前激活数据集的 ImageStore。
 *
 * 路由层每次请求前调用（传 req.user.userId）：
 * - 有 active → 返回 { dataset, imageStore }。
 * - 无 active → 返回 undefined（首次启动场景，ensureDefaultDataset 会兜底）。
 */
export async function getActiveImageStore(
  userId: string = LOCAL_USER_ID,
): Promise<ActiveImageStore | undefined> {
  openMasterDb();
  const active = getActiveDataset(userId);
  if (!active) return undefined;
  const config = parseStorageConfig(active.storage_config, active.storage_kind);
  const imageStore = buildImageStore(active.image_store_kind, config, userId);
  return { dataset: toView(active), imageStore };
}

/** 列出指定用户的全部数据集（视图类型）。 */
export function listDatasetViews(userId: string = LOCAL_USER_ID): DatasetView[] {
  openMasterDb();
  return listDatasets(userId).map(toView);
}

/** 按主键查数据集（视图类型，限指定用户防越权）。 */
export function getDatasetView(id: string, userId: string = LOCAL_USER_ID): DatasetView | undefined {
  openMasterDb();
  const record = listDatasets(userId).find((d) => d.id === id);
  return record ? toView(record) : undefined;
}

/**
 * 删除数据集（级联，限指定用户防越权）：
 * 1. 关闭对应业务 db 连接（避免文件占用）。
 * 2. 删业务 db 文件（+ WAL/-shm 副产物）。
 * 3. 删 registry 记录。
 *
 * 注意：不删图片文件——图片文件可能被多个数据集引用（虽然指纹去重使这不太可能），
 * 且图片目录可能是用户自选的（选项 A），不应由 Companion 删除。
 * 图片清理留给未来的「孤儿图片回收」机制。
 */
export async function deleteDatasetCascade(
  id: string,
  userId: string = LOCAL_USER_ID,
): Promise<void> {
  openMasterDb();
  const record = listDatasets(userId).find((d) => d.id === id);
  if (!record) return; // 不存在或不属于该用户是 no-op

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
  deleteDatasetRecord(id, userId);
}

/**
 * 重命名数据集（只改 label，限指定用户防越权）。
 */
export function renameDatasetView(
  id: string,
  label: string,
  userId: string = LOCAL_USER_ID,
): void {
  openMasterDb();
  renameDataset(id, label, userId);
}

/**
 * Companion 启动时保证指定用户有一个可用的默认数据集（选项 B）。
 *
 * - 无任何数据集 → 创建选项 B 默认数据集并激活。
 * - 有数据集但无 active → 激活最近一个。
 * - 有 active → no-op。
 *
 * local 模式不传 userId（用默认 '__local__'）；server 模式每个用户首次访问时各自兜底。
 */
export async function ensureDefaultDataset(userId: string = LOCAL_USER_ID): Promise<DatasetView> {
  openMasterDb();
  const active = getActiveDataset(userId);
  if (active) return toView(active);

  const all = listDatasets(userId);
  if (all.length > 0) {
    // 有数据集但没 active，激活最近一个
    const latest = all[0]; // listDatasets 已按 activated_at 倒序
    activateDataset(latest.id, new Date().toISOString(), userId);
    return toView({ ...latest, is_active: 1 });
  }

  // 完全没数据集，创建默认（选项 B）
  const result = await resolveAndActivate({
    storageKind: "filesystem",
    storageConfig: { directory: defaultImagesDir() },
    imageStoreKind: "filesystem-default",
    label: "默认目录",
    userId,
  });
  return result.dataset;
}
