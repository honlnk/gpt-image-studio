/**
 * StudioStorage 抽象层 —— 阶段一地基。
 *
 * 设计纲领：docs/evolution-roadmap.md §6.1。
 * 核心约束：保持纯 CRUD（决策 T2），不支持 query by index；
 *           不暴露事务原语（§6.1 事务性约束）。
 *
 * 所有前端业务代码（store / service / 组件）通过此接口访问存储后端，
 * 不允许直接调 IndexedDB / fetch / invoke（约束 D5）。
 */

/** 7 张业务表的 store 名，作为接口公开常量。未来直接对齐 SQLite 表名。 */
export const STORE_NAMES = {
  conversations: "conversations",
  messages: "messages",
  imageAssets: "imageAssets",
  imageBlobs: "imageBlobs",
  settings: "settings",
  conversationDrafts: "conversationDrafts",
  analyticsEvents: "analyticsEvents",
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

/**
 * 图片二进制记录。收敛自当前在 imageAssets.ts / backups.ts / storageUsage.ts
 * 三处的重复定义。PR6 完成后，三处统一从此导入。
 */
export type ImageBlobRecord = {
  key: string;
  blob: Blob;
};

/**
 * 后端标识。UI 顶栏据此显示"本地 IndexedDB / Companion 文件系统 / Companion OSS / APP 本地"。
 * 阶段一只有 "indexeddb" 一个真实实现，"companion" / "native" 是骨架。
 */
export type StorageBackend = "indexeddb" | "companion" | "native";

/**
 * 存储后端的统一抽象。承载 KV（IndexedDB）和关系型（SQLite/后端 DB）两种形态。
 *
 * 语义约束（契约测试套件必须覆盖，见 storage.contract.test.ts）：
 * - list：空表返回 []，不抛错；返回顺序不保证（调用方需要排序就自己排）。
 * - get：key 不存在返回 undefined，不抛 KEY_NOT_FOUND。
 * - put：upsert；同一 key 反复 put 只保留最后值。
 * - delete：key 不存在是 no-op，不抛错。
 * - clear：只清当前 collection，不影响其它；clear 后 list 返回 []。
 * - saveImageBlob / loadImageBlob / deleteImageBlob：与 put/get/delete 同语义，
 *   但走 imageBlobs 表的语义化封装。
 * - readConfig / writeConfig：与 get/put 同语义，但走独立的 config 命名空间
 *   （阶段一落到 settings 表的 __config__: 前缀 key，不污染业务 app 记录）。
 *
 * 事务性：接口不暴露事务原语。备份/恢复的原子性由实现层保障（IndexedDbStorage
 * 内部处理），不是接口契约。
 */
export interface StudioStorage {
  /** 后端标识，只读。 */
  readonly backend: StorageBackend;

  // ─── 通用 CRUD（6 张元数据表 + imageBlobs 也走这套） ───

  /** 列出某 collection 的全部记录。无记录返回空数组，不抛错。 */
  list<T>(store: StoreName): Promise<T[]>;

  /** 按 keyPath 取单条。找不到返回 undefined，不抛错。 */
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;

  /** upsert 语义：key 存在则覆盖，不存在则插入。 */
  put<T>(store: StoreName, value: T): Promise<void>;

  /** 删单条。key 不存在是 no-op，不抛错。 */
  delete(store: StoreName, key: IDBValidKey): Promise<void>;

  /** 清空单 collection 的全部记录。不影响其它 collection。 */
  clear(store: StoreName): Promise<void>;

  // ─── 图片二进制（imageBlobs 表的语义化封装） ───

  /** 保存图片二进制。统一用 Blob 类型（Web 原生、阶段二 multipart 直接用、
   * 阶段四实现内部转 Uint8Array）。 */
  saveImageBlob(key: string, blob: Blob): Promise<void>;

  /** 读取图片二进制。找不到返回 undefined。imageEditRequest 等调用方依赖此语义做错误处理。 */
  loadImageBlob(key: string): Promise<Blob | undefined>;

  /** 删图片二进制。key 不存在是 no-op。 */
  deleteImageBlob(key: string): Promise<void>;

  // ─── 轻量配置（取代 localStorage，键值形态） ───

  /** 读配置项。找不到返回 undefined。 */
  readConfig<T>(key: string): Promise<T | undefined>;

  /** 写配置项。upsert 语义。 */
  writeConfig<T>(key: string, value: T): Promise<void>;

  // ─── 容量估算（拆成必选 + 可选，见 §6.1 容量估算拆分说明） ───

  /** 业务数据字节（imageBytes + metadataBytes）。所有后端必选，基于实际存储内容计算。 */
  estimateStoredBytes(): Promise<{ imageBytes: number; metadataBytes: number }>;

  /** 浏览器/系统配额。可选——Web 实现透传 navigator.storage.estimate()，
   * 其它后端不实现时返回 undefined。 */
  estimateQuota?(): Promise<{ usage?: number; quota?: number }>;
}

/**
 * 存储层错误的基类。错误类型粒度作为未决问题（evolution-roadmap.md 第十二章），
 * 阶段一先采用粗粒度 + code 字段方案。
 */
export class StorageError extends Error {
  readonly code:
    | "KEY_NOT_FOUND" // 显式 get/delete 时报告（注：默认语义是 no-op，仅当调用方要求严格模式时抛）
    | "QUOTA_EXCEEDED" // 配额不足（IndexedDB / 文件系统 / OSS 配额）
    | "BACKEND_UNAVAILABLE" // 后端不可达（Companion 离线、Tauri invoke 失败、骨架未实现）
    | "SERIALIZATION_ERROR" // Blob/JSON 序列化失败
    | "UNKNOWN";
  readonly cause?: unknown;

  constructor(
    code: StorageError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}
