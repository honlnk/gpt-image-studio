/**
 * CompanionStorage —— StudioStorage 的 Companion 后端实现（阶段二填充）。
 *
 * 阶段一：骨架，所有方法抛 BACKEND_UNAVAILABLE。
 * 阶段二：把骨架替换为 fetch 调用 `${companionUrl}/storage/*`，
 *         图片二进制走 multipart，配置走 Companion settings 表。
 *         见 evolution-roadmap.md 第七章。
 */
import { StorageError, type StoreName, type StudioStorage } from "./types";

const NOT_IMPLEMENTED = new StorageError(
  "BACKEND_UNAVAILABLE",
  "CompanionStorage is not implemented yet (planned for phase 2). " +
    "Use IndexedDbStorage or resolveStorage() until Companion storage backend lands.",
);

export class CompanionStorage implements StudioStorage {
  readonly backend = "companion" as const;

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
