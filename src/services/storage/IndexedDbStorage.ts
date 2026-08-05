/**
 * IndexedDbStorage —— StudioStorage 的 IndexedDB 实现。
 *
 * 阶段一搬迁自 src/services/db.ts 的全部逻辑（DB_NAME / DB_VERSION /
 * onupgradeneeded / replaceIndex / 5 个泛型 CRUD），保证 schema 与现状完全一致。
 * PR1 与 db.ts 并存（db.ts 在 PR6 删除）。
 *
 * 新增能力（db.ts 原本没有的）：
 * - saveImageBlob / loadImageBlob / deleteImageBlob：封装 imageBlobs 表的语义化访问。
 * - readConfig / writeConfig：用 `__config__:` 前缀复用 settings 表，不新建 store、不改 schema。
 * - estimateStoredBytes / estimateQuota：从 storageUsage.ts 收编的容量估算逻辑。
 */
import {
  CONVERSATION_FILTERABLE_STORES,
  STORE_NAMES,
  STORE_SORT_FIELDS,
  StorageError,
  decodePageCursor,
  encodePageCursor,
  isBeforePageCursor,
  type ImageBlobRecord,
  type ListPageOptions,
  type ListPageResult,
  type StudioStorage,
  type StoreName,
} from "./types";

const DB_NAME = "gpt-image-studio";
const DB_VERSION = 4;

/** config 命名空间前缀。复用 settings 表，避免新建 store 触发 schema 升级。 */
const CONFIG_KEY_PREFIX = "__config__:";

const METADATA_STORES: readonly StoreName[] = [
  STORE_NAMES.conversations,
  STORE_NAMES.messages,
  STORE_NAMES.imageAssets,
  STORE_NAMES.settings,
  STORE_NAMES.conversationDrafts,
] as const;

export class IndexedDbStorage implements StudioStorage {
  readonly backend = "indexeddb" as const;

  private dbPromise: Promise<IDBDatabase> | null = null;

  /** 暴露底层 IDBDatabase 句柄，供同库其它实现（如备份的原子性保障）复用。
   *  阶段一仅 IndexedDbStorage 内部使用，不进 StudioStorage 接口。 */
  getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDb();
    }
    return this.dbPromise;
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const transaction = request.transaction;

        if (!db.objectStoreNames.contains(STORE_NAMES.conversations)) {
          const store = db.createObjectStore(STORE_NAMES.conversations, {
            keyPath: "id",
          });
          store.createIndex("updatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.messages)) {
          const store = db.createObjectStore(STORE_NAMES.messages, {
            keyPath: "id",
          });
          store.createIndex("conversationId", "conversationId");
          store.createIndex("createdAt", "createdAt");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.imageAssets)) {
          const store = db.createObjectStore(STORE_NAMES.imageAssets, {
            keyPath: "id",
          });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("conversationId", "conversationId");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.imageBlobs)) {
          db.createObjectStore(STORE_NAMES.imageBlobs, {
            keyPath: "key",
          });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
          db.createObjectStore(STORE_NAMES.settings, {
            keyPath: "key",
          });
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.conversationDrafts)) {
          const store = db.createObjectStore(STORE_NAMES.conversationDrafts, {
            keyPath: "conversationId",
          });
          store.createIndex("updatedAtMs", "updatedAtMs");
        }

        if (!db.objectStoreNames.contains(STORE_NAMES.analyticsEvents)) {
          const store = db.createObjectStore(STORE_NAMES.analyticsEvents, {
            keyPath: "id",
          });
          store.createIndex("occurredAt", "occurredAt");
          store.createIndex("eventName", "eventName");
          store.createIndex("conversationId", "conversationId");
        }

        if (event.oldVersion < 2) {
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.conversations,
            "updatedAtMs",
            "updatedAt",
          );
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.messages,
            "createdAtMs",
            "createdAt",
          );
          replaceIndex(
            transaction,
            db,
            STORE_NAMES.imageAssets,
            "createdAtMs",
            "createdAt",
          );
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async list<T>(store: StoreName): Promise<T[]> {
    const db = await this.getDb();
    const transaction = db.transaction(store, "readonly");
    const objectStore = transaction.objectStore(store);
    return requestToPromise<T[]>(objectStore.getAll());
  }

  /**
   * 分页查询（server 模式分页 PR-b）。沿排序字段索引按 DESC（"prev"）遍历 cursor，
   * 跳过游标位置之前/不匹配 conversationId 的记录，取 limit 条并多探 1 条判断 hasMore。
   *
   * 本地数据量小，遍历跳过的成本可接受；排序字段缺失的记录不在索引里
   * （IDB 索引跳过缺字段记录），与服务端 NULL 排最后的脏数据容忍语义一致。
   */
  async listPage<T>(store: StoreName, opts: ListPageOptions): Promise<ListPageResult<T>> {
    const sortField = STORE_SORT_FIELDS[store];
    if (!sortField) {
      throw new StorageError("UNKNOWN", `store ${store} 不支持分页查询`);
    }
    if (opts.conversationId !== undefined && !CONVERSATION_FILTERABLE_STORES.includes(store)) {
      throw new StorageError("UNKNOWN", `store ${store} 不支持 conversationId 过滤`);
    }
    const db = await this.getDb();
    const transaction = db.transaction(store, "readonly");
    const objectStore = transaction.objectStore(store);

    // total：过滤条件下的总条数（不受 before/limit 影响）
    const total =
      opts.conversationId !== undefined
        ? await requestToPromise<number>(
            objectStore
              .index("conversationId")
              .count(IDBKeyRange.only(opts.conversationId)),
          )
        : await requestToPromise<number>(objectStore.count());

    const cursorPos = opts.before !== undefined ? decodePageCursor(opts.before) : null;
    const data: T[] = [];
    let lastSort: string | null = null;
    let lastKey: string | null = null;
    let hasMore = false;

    await new Promise<void>((resolve, reject) => {
      const request = objectStore.index(sortField).openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const sortValue = typeof cursor.key === "string" ? cursor.key : null;
        const primaryKey = String(cursor.primaryKey);
        // 游标位置之前（更新一侧）的记录跳过
        if (cursorPos && !isBeforePageCursor(sortValue, primaryKey, cursorPos[0], cursorPos[1])) {
          cursor.continue();
          return;
        }
        if (opts.conversationId !== undefined) {
          const record = cursor.value as { conversationId?: string };
          if (record.conversationId !== opts.conversationId) {
            cursor.continue();
            return;
          }
        }
        if (data.length < opts.limit) {
          data.push(cursor.value as T);
          lastSort = sortValue;
          lastKey = primaryKey;
          cursor.continue();
          return;
        }
        // 已取满 limit 条，再命中 1 条说明还有下一页
        hasMore = true;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    return {
      data,
      nextCursor: hasMore && lastKey !== null ? encodePageCursor(lastSort, lastKey) : null,
      total,
    };
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.getDb();
    const transaction = db.transaction(store, "readonly");
    const objectStore = transaction.objectStore(store);
    return requestToPromise<T | undefined>(objectStore.get(key));
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.put(value as unknown as object);
    await transactionDone(transaction);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.delete(key);
    await transactionDone(transaction);
  }

  async clear(store: StoreName): Promise<void> {
    const db = await this.getDb();
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.clear();
    await transactionDone(transaction);
  }

  async saveImageBlob(key: string, blob: Blob): Promise<void> {
    await this.put<ImageBlobRecord>(STORE_NAMES.imageBlobs, { key, blob });
  }

  async loadImageBlob(key: string): Promise<Blob | undefined> {
    const record = await this.get<ImageBlobRecord>(STORE_NAMES.imageBlobs, key);
    return record?.blob;
  }

  async deleteImageBlob(key: string): Promise<void> {
    await this.delete(STORE_NAMES.imageBlobs, key);
  }

  async readConfig<T>(key: string): Promise<T | undefined> {
    const record = await this.get<{ key: string; value: T }>(
      STORE_NAMES.settings,
      this.configKey(key),
    );
    return record?.value;
  }

  async writeConfig<T>(key: string, value: T): Promise<void> {
    await this.put<{ key: string; value: T }>(STORE_NAMES.settings, {
      key: this.configKey(key),
      value,
    });
  }

  async estimateStoredBytes(): Promise<{
    imageBytes: number;
    metadataBytes: number;
  }> {
    const [imageBlobs, metadataPayloads] = await Promise.all([
      this.list<ImageBlobRecord>(STORE_NAMES.imageBlobs),
      Promise.all(
        METADATA_STORES.map((store) => this.list<unknown>(store)),
      ),
    ]);

    const imageBytes = imageBlobs.reduce(
      (total, record) => total + (record.blob?.size ?? 0),
      0,
    );

    const [conversations, messages, imageAssets, settings, conversationDrafts] =
      metadataPayloads;
    const serializedMetadataBytes = byteSizeOfJson({
      conversations,
      messages,
      imageAssets,
      settings,
      conversationDrafts,
    });

    // 与现有 storageUsage.ts 的 metadataBytes 语义保持一致：
    // 取序列化字节数与 (browserUsage - imageBytes) 的较大值。
    // browserUsage 来自 navigator.storage.estimate()，仅在 Web 实现中可用。
    const browserEstimate = await this.estimateQuota?.();
    const browserUsageBytes = browserEstimate?.usage;
    const metadataBytes = Math.max(
      serializedMetadataBytes,
      browserUsageBytes != null ? browserUsageBytes - imageBytes : 0,
    );

    return { imageBytes, metadataBytes };
  }

  async estimateQuota(): Promise<{ usage?: number; quota?: number }> {
    if (!navigator.storage?.estimate) {
      return {};
    }
    try {
      return await navigator.storage.estimate();
    } catch {
      return {};
    }
  }

  private configKey(key: string): string {
    return `${CONFIG_KEY_PREFIX}${key}`;
  }
}

function replaceIndex(
  transaction: IDBTransaction | null,
  db: IDBDatabase,
  storeName: StoreName,
  oldIndexName: string,
  newIndexName: string,
) {
  if (!transaction || !db.objectStoreNames.contains(storeName)) return;

  const store = transaction.objectStore(storeName);
  if (store.indexNames.contains(oldIndexName)) {
    store.deleteIndex(oldIndexName);
  }
  if (!store.indexNames.contains(newIndexName)) {
    store.createIndex(newIndexName, newIndexName);
  }
}

function requestToPromise<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function byteSizeOfJson(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

// StorageError 在本文件用于未来 IndexedDB 特定错误的归一化封装；
// 当前实现透传 IDB 原生错误（与现状 db.ts 一致，避免行为变化），
// 此 re-export 保持模块自洽，调用方可通过此入口拿到 StorageError 类型。
export { StorageError };
