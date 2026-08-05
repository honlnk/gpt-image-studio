/**
 * StudioStorage 抽象层 —— 阶段一地基。
 *
 * 设计纲领：docs/evolution-roadmap.md §6.1。
 * 核心约束：保持纯 CRUD（决策 T2）；不暴露事务原语（§6.1 事务性约束）。
 *
 * T2 修订（2026-08-03，server 模式分页 PR-b）：纯 CRUD 仍是基线，但引入
 * 受控的可选分页查询 listPage——只支持「单排序字段 DESC + 可选 conversationId
 * 过滤 + 游标翻页」，不是通用 query by index。动机与分层方案见
 * docs/evolution/backlog-server-pagination.md。未实现 listPage 的后端，
 * 调用方回退 list 全量 + 内存分页。
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

// ─── 分页查询（listPage，server 模式分页 PR-b） ───

/**
 * 各 store 的服务端排序字段（业务对象内的字段名，ISO 8601 字符串，字典序=时间序）。
 * 只有列在这里的 store 支持 listPage；排序统一 DESC（最新在前），
 * 调用方要正序展示时自行 reverse（如聊天消息）。
 */
export const STORE_SORT_FIELDS: Partial<Record<StoreName, string>> = {
  conversations: "updatedAt",
  messages: "createdAt",
  imageAssets: "createdAt",
};

/** 支持 conversationId 过滤的 store（业务对象有 conversationId 字段）。 */
export const CONVERSATION_FILTERABLE_STORES: readonly StoreName[] = [
  "messages",
  "imageAssets",
];

/** 各 store 的主键字段（keyPath），与 IndexedDB schema / Companion 约定一致。 */
export const STORE_KEY_PATHS: Record<StoreName, string> = {
  conversations: "id",
  messages: "id",
  imageAssets: "id",
  imageBlobs: "key",
  settings: "key",
  conversationDrafts: "conversationId",
  analyticsEvents: "id",
};

export type ListPageOptions = {
  /** 按 conversationId 过滤（仅 CONVERSATION_FILTERABLE_STORES 支持）。 */
  conversationId?: string;
  /** 上一页返回的 nextCursor。opaque——只允许原样回传，不允许解析/构造。 */
  before?: string;
  /** 页大小。各实现可有上限（Companion 后端 1..200）。 */
  limit: number;
};

export type ListPageResult<T> = {
  /** 本页记录，按排序字段 DESC（最新在前）。 */
  data: T[];
  /** 还有更早记录时为下一页游标，否则 null。 */
  nextCursor: string | null;
  /** 满足过滤条件的总条数，不受 before/limit 影响，供"共 N 条"计数。 */
  total: number;
};

/**
 * 本地实现（IndexedDb / InMemory）的游标编解码：JSON([排序值, 主键])。
 * 双字段为排序值相同时的稳定 tiebreak。CompanionStorage 不构造游标——
 * 服务端游标（base64url 格式）原样透传回服务端，两边格式互不相通也不要紧，
 * 契约只有一条：调用方把 nextCursor 当 opaque 字符串回传。
 */
export function encodePageCursor(sortValue: string | null, key: string): string {
  return JSON.stringify([sortValue, key]);
}

/** 解码失败返回 null（调用方视作无游标从头开始，或按实现策略抛错）。 */
export function decodePageCursor(cursor: string): [string | null, string] | null {
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === "string" || parsed[0] === null) &&
      typeof parsed[1] === "string"
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // fallthrough
  }
  return null;
}

/**
 * 游标谓词：DESC 序下 (sortValue, key) 是否位于游标 (cursorSort, cursorKey) 之后
 * （即"更早"一侧）。排序值相等时按 key DESC tiebreak，防同值跨页漏重。
 */
export function isBeforePageCursor(
  sortValue: string | null,
  key: string,
  cursorSort: string | null,
  cursorKey: string,
): boolean {
  if (sortValue === null) return false; // NULL 排最后且不可翻页（脏数据容忍，与服务端一致）
  if (cursorSort === null) return false;
  if (sortValue !== cursorSort) return sortValue < cursorSort;
  return key < cursorKey;
}

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

  /**
   * 分页查询（可选方法，T2 修订后引入，server 模式分页 PR-b）。
   * 仅支持 STORE_SORT_FIELDS 列出的 store；排序统一 DESC。
   * 调用方必须先探测方法是否存在，不存在时回退 list 全量 + 内存分页。
   */
  listPage?<T>(store: StoreName, opts: ListPageOptions): Promise<ListPageResult<T>>;

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
