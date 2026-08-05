/**
 * NativeStorage —— StudioStorage 的 Tauri/原生实现（阶段四填充）。
 *
 * 阶段一：骨架，所有方法抛 BACKEND_UNAVAILABLE。
 * 阶段四：把骨架替换为 invoke("storage_put", ...) 调用，SQLite 建表，
 *         表名 = STORE_NAMES，字段对齐 studio.ts 类型。
 *         见 evolution-roadmap.md 第九章。
 *
 * 阶段四当前暂不实施，本骨架仅保留接口接入位置。
 */
import { StorageError, type StoreName, type StudioStorage } from "./types";

const NOT_IMPLEMENTED = new StorageError(
  "BACKEND_UNAVAILABLE",
  "NativeStorage is not implemented yet (planned for phase 4, currently on hold). " +
    "Use IndexedDbStorage or resolveStorage() until the native storage backend lands.",
);

export class NativeStorage implements StudioStorage {
  readonly backend = "native" as const;

  list<T>(_store: StoreName): Promise<T[]> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  get<T>(_store: StoreName, _key: IDBValidKey): Promise<T | undefined> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  put<T>(_store: StoreName, _value: T): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  delete(_store: StoreName, _key: IDBValidKey): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  clear(_store: StoreName): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  saveImageBlob(_key: string, _blob: Blob): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  loadImageBlob(_key: string): Promise<Blob | undefined> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  deleteImageBlob(_key: string): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  readConfig<T>(_key: string): Promise<T | undefined> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  writeConfig<T>(_key: string, _value: T): Promise<void> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
  estimateStoredBytes(): Promise<{
    imageBytes: number;
    metadataBytes: number;
  }> {
    return Promise.reject(NOT_IMPLEMENTED);
  }
}
