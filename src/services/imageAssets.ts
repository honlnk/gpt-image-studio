import type { ImageAsset } from "../types/studio";
import { timestampFromCreatedAt } from "../shared/dateTime";
import { STORE_NAMES, type StudioStorage } from "./storage";
import { resolveStorage } from "./storage/resolveStorage";

/**
 * 图片元数据（imageAssets）+ 图片二进制（imageBlobs）的存储服务。
 *
 * 是 6 个 domain service 里唯一跨两 store 的：元数据走 imageAssets 表，
 * 二进制走 imageBlobs 表（keyPath="key"）。
 *
 * 阶段一 PR2 改工厂注入（决策 T1）。ImageBlobRecord 从 storage/types 统一导入。
 */
export type ImageAssetServices = ReturnType<typeof createImageAssetServices>;

export function createImageAssetServices(storage: StudioStorage) {
  return {
    async listAssets() {
      const imageAssets = await storage.list<ImageAsset>(
        STORE_NAMES.imageAssets,
      );
      return imageAssets.sort(
        (a, b) => timestampFromCreatedAt(b) - timestampFromCreatedAt(a),
      );
    },
    saveAsset(imageAsset: ImageAsset) {
      return storage.put(STORE_NAMES.imageAssets, imageAsset);
    },
    deleteAsset(id: string) {
      return storage.delete(STORE_NAMES.imageAssets, id);
    },
    // 二进制必须走专用 blob 方法，不能用通用 put/get：
    // IndexedDB 后端结构化克隆能保住 Blob（通用路径恰好能跑），但 Companion
    // 后端的通用 put 是 JSON.stringify——Blob 会被序列化成 {}，二进制直接丢失，
    // hydrate 时读回普通对象会让 URL.createObjectURL 抛 Overload resolution failed。
    saveBlob(key: string, blob: Blob) {
      return storage.saveImageBlob(key, blob);
    },
    deleteBlob(key: string) {
      return storage.deleteImageBlob(key);
    },
    loadBlob(key: string) {
      return storage.loadImageBlob(key);
    },
  };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultServices = createImageAssetServices(resolveStorage());

export async function listImageAssets() {
  return defaultServices.listAssets();
}

export function saveImageAsset(imageAsset: ImageAsset) {
  return defaultServices.saveAsset(imageAsset);
}

export function deleteImageAsset(id: string) {
  return defaultServices.deleteAsset(id);
}

export function saveImageBlob(key: string, blob: Blob) {
  return defaultServices.saveBlob(key, blob);
}

export function deleteImageBlob(key: string) {
  return defaultServices.deleteBlob(key);
}

export async function loadImageBlob(key: string) {
  return defaultServices.loadBlob(key);
}
