import type { Conversation, ImageAsset, Message } from "../types/studio";
import {
  STORE_NAMES,
  type ImageBlobRecord,
  type StudioStorage,
} from "./storage";
import { resolveStorage } from "./storage/resolveStorage";

export type StorageUsage = {
  imageBytes: number;
  metadataBytes: number;
  projectBytes: number;
  browserUsageBytes?: number;
  quotaBytes?: number;
};

/** 容量估算服务（跨 6 collection 的整库只读操作）。阶段一 PR3 改工厂注入（决策 T1）。 */
export type StorageUsageServices = ReturnType<
  typeof createStorageUsageServices
>;

export function createStorageUsageServices(storage: StudioStorage) {
  return {
    async estimate(): Promise<StorageUsage> {
      const [
        conversations,
        messages,
        imageAssets,
        imageBlobs,
        settings,
        conversationDrafts,
        browserEstimate,
      ] = await Promise.all([
        storage.list<Conversation>(STORE_NAMES.conversations),
        storage.list<Message>(STORE_NAMES.messages),
        storage.list<ImageAsset>(STORE_NAMES.imageAssets),
        storage.list<ImageBlobRecord>(STORE_NAMES.imageBlobs),
        storage.list<unknown>(STORE_NAMES.settings),
        storage.list<unknown>(STORE_NAMES.conversationDrafts),
        estimateBrowserStorage(),
      ]);

      const imageBytes = imageBlobs.reduce(
        (total, record) => total + (record.blob?.size ?? 0),
        0,
      );
      const serializedMetadataBytes = byteSizeOfJson({
        conversations,
        messages,
        imageAssets,
        settings,
        conversationDrafts,
      });
      const browserUsageBytes = browserEstimate.usage;
      const metadataBytes = Math.max(
        serializedMetadataBytes,
        browserUsageBytes ? browserUsageBytes - imageBytes : 0,
      );

      return {
        imageBytes,
        metadataBytes,
        projectBytes: imageBytes + metadataBytes,
        browserUsageBytes,
        quotaBytes: browserEstimate.quota,
      };
    },
  };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultStorageUsageServices = createStorageUsageServices(
  resolveStorage(),
);

export async function estimateStorageUsage(): Promise<StorageUsage> {
  return defaultStorageUsageServices.estimate();
}

async function estimateBrowserStorage() {
  if (!navigator.storage?.estimate) {
    return {};
  }

  try {
    return await navigator.storage.estimate();
  } catch {
    return {};
  }
}

function byteSizeOfJson(value: unknown) {
  return new Blob([JSON.stringify(value)]).size;
}
