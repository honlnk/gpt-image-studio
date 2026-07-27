/**
 * InMemoryStorage —— StudioStorage 的纯内存 mock 实现。
 *
 * 用途：契约测试套件的"换实现不改接口"验证。阶段一只有 IndexedDbStorage
 * 一个真实实现，若无第二个实现跑同一份契约用例，"换实现不改接口"的承诺
 * 完全无法验证。InMemoryStorage 成本极低（纯内存 Map），却能让契约套件
 * 从 PR1 起就跑在两个实现上，提前发现接口设计的不一致。
 *
 * **不是生产实现**，不进 resolveStorage() 的分叉。阶段二/四的真实实现
 * （CompanionStorage / NativeStorage）会各自接入契约套件。
 *
 * 语义对齐：实现必须严格遵循 types.ts 的语义约束（空表返回 []、key 不存在
 * 返回 undefined、put 是 upsert、delete 是 no-op、clear 只清当前 collection），
 * 否则契约套件失去意义。
 */
import {
  STORE_NAMES,
  type ImageBlobRecord,
  type StoreName,
  type StudioStorage,
} from "./types";

type RecordMap = Map<IDBValidKey, unknown>;

/** 与 IndexedDbStorage 的 CONFIG_KEY_PREFIX 对齐，保证两实现 config 命名空间一致。 */
const CONFIG_KEY_PREFIX = "__config__:";

export class InMemoryStorage implements StudioStorage {
  readonly backend = "indexeddb" as const; // mock 伪装成 indexeddb，不引入新 backend 类型

  private readonly stores: Map<StoreName, RecordMap>;

  constructor() {
    this.stores = new Map(
      (Object.values(STORE_NAMES) as StoreName[]).map((name) => [
        name,
        new Map<IDBValidKey, unknown>(),
      ]),
    );
  }

  async list<T>(store: StoreName): Promise<T[]> {
    const map = this.requireStore(store);
    return Array.from(map.values()) as T[];
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const map = this.requireStore(store);
    return map.get(key) as T | undefined;
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    const map = this.requireStore(store);
    const key = this.extractKey(store, value);
    map.set(key, value);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const map = this.requireStore(store);
    map.delete(key);
  }

  async clear(store: StoreName): Promise<void> {
    const map = this.requireStore(store);
    map.clear();
  }

  async saveImageBlob(key: string, blob: Blob): Promise<void> {
    await this.put<ImageBlobRecord>(STORE_NAMES.imageBlobs, { key, blob });
  }

  async loadImageBlob(key: string): Promise<Blob | undefined> {
    const record = await this.get<ImageBlobRecord>(
      STORE_NAMES.imageBlobs,
      key,
    );
    return record?.blob;
  }

  async deleteImageBlob(key: string): Promise<void> {
    await this.delete(STORE_NAMES.imageBlobs, key);
  }

  async readConfig<T>(key: string): Promise<T | undefined> {
    // 与 IndexedDbStorage 对齐：config 走 settings 表的 __config__: 前缀，
    // 复用业务表避免引入新 store。这样契约套件的"settings 表条目数"断言
    // 对两个实现语义一致。
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
    const imageBlobs = await this.list<ImageBlobRecord>(
      STORE_NAMES.imageBlobs,
    );
    const imageBytes = imageBlobs.reduce(
      (total, record) => total + (record.blob?.size ?? 0),
      0,
    );

    const metadataStores: StoreName[] = [
      STORE_NAMES.conversations,
      STORE_NAMES.messages,
      STORE_NAMES.imageAssets,
      STORE_NAMES.settings,
      STORE_NAMES.conversationDrafts,
    ];
    const metadataPayloads = await Promise.all(
      metadataStores.map((store) => this.list<unknown>(store)),
    );
    const metadataBytes = byteSizeOfJson(metadataPayloads);

    return { imageBytes, metadataBytes };
  }

  /** mock 不实现 quota 估算，返回空对象（与接口可选语义一致）。 */
  async estimateQuota(): Promise<{ usage?: number; quota?: number }> {
    return {};
  }

  /** 重置全部内存数据，测试 cleanup 用。 */
  reset(): void {
    for (const map of this.stores.values()) map.clear();
  }

  private configKey(key: string): string {
    return `${CONFIG_KEY_PREFIX}${key}`;
  }

  private requireStore(store: StoreName): RecordMap {
    const map = this.stores.get(store);
    if (!map) {
      throw new Error(`InMemoryStorage: unknown store "${store}"`);
    }
    return map;
  }

  /** 从记录里按 store 的 keyPath 抽取主键，与 IndexedDB schema 对齐。 */
  private extractKey(store: StoreName, value: unknown): IDBValidKey {
    const record = value as Record<string, unknown>;
    const keyPath = KEY_PATHS[store];
    const key = record[keyPath];
    if (key === undefined || key === null) {
      throw new Error(
        `InMemoryStorage: record for store "${store}" missing keyPath "${keyPath}"`,
      );
    }
    return key as IDBValidKey;
  }
}

/** 与 IndexedDbStorage 的 schema（db.ts onupgradeneeded）对齐的 keyPath 映射。 */
const KEY_PATHS: Record<StoreName, string> = {
  conversations: "id",
  messages: "id",
  imageAssets: "id",
  imageBlobs: "key",
  settings: "key",
  conversationDrafts: "conversationId",
  analyticsEvents: "id",
};

function byteSizeOfJson(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}
