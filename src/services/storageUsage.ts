import type { Conversation, ImageAsset, Message } from "../types/studio";
import { getAllFromStore, STORE_NAMES } from "./db";

type ImageBlobRecord = {
  key: string;
  blob: Blob;
};

export type StorageUsage = {
  imageBytes: number;
  metadataBytes: number;
  projectBytes: number;
  browserUsageBytes?: number;
  quotaBytes?: number;
};

export async function estimateStorageUsage(): Promise<StorageUsage> {
  const [
    conversations,
    messages,
    imageAssets,
    imageBlobs,
    settings,
    browserEstimate,
  ] = await Promise.all([
    getAllFromStore<Conversation>(STORE_NAMES.conversations),
    getAllFromStore<Message>(STORE_NAMES.messages),
    getAllFromStore<ImageAsset>(STORE_NAMES.imageAssets),
    getAllFromStore<ImageBlobRecord>(STORE_NAMES.imageBlobs),
    getAllFromStore<unknown>(STORE_NAMES.settings),
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
