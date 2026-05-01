import type { ImageAsset } from "../types/studio";
import { deleteFromStore, getAllFromStore, getFromStore, putInStore, STORE_NAMES } from "./db";

type ImageBlobRecord = {
  key: string;
  blob: Blob;
};

export async function listImageAssets() {
  const imageAssets = await getAllFromStore<ImageAsset>(STORE_NAMES.imageAssets);

  return imageAssets.sort(
    (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
  );
}

export function saveImageAsset(imageAsset: ImageAsset) {
  return putInStore(STORE_NAMES.imageAssets, imageAsset);
}

export function deleteImageAsset(id: string) {
  return deleteFromStore(STORE_NAMES.imageAssets, id);
}

export function saveImageBlob(key: string, blob: Blob) {
  return putInStore<ImageBlobRecord>(STORE_NAMES.imageBlobs, { key, blob });
}

export function deleteImageBlob(key: string) {
  return deleteFromStore(STORE_NAMES.imageBlobs, key);
}

export async function loadImageBlob(key: string) {
  const record = await getFromStore<ImageBlobRecord>(
    STORE_NAMES.imageBlobs,
    key,
  );

  return record?.blob;
}
