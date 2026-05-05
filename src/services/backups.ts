import type { AppSettings, Conversation, ImageAsset, Message } from "../types/studio";
import { clearStore, getAllFromStore, putInStore, STORE_NAMES } from "./db";
import { saveSettings, loadSettings } from "./settings";
import { createZipArchive } from "./zipArchive";

const BACKUP_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const DATA_FILE = "data.json";

type ImageBlobRecord = {
  key: string;
  blob: Blob;
};

type BackupManifest = {
  app: "gpt-image-studio";
  version: number;
  exportedAt: string;
  excludes: string[];
};

type BackupData = {
  conversations: Conversation[];
  messages: Message[];
  imageAssets: ImageAsset[];
  settings?: Omit<AppSettings, "apiKey">;
};

type ZipFileMap = Map<string, Blob>;

export async function createStudioBackup() {
  const [conversations, messages, imageAssets, imageBlobs, settings] =
    await Promise.all([
      getAllFromStore<Conversation>(STORE_NAMES.conversations),
      getAllFromStore<Message>(STORE_NAMES.messages),
      getAllFromStore<ImageAsset>(STORE_NAMES.imageAssets),
      getAllFromStore<ImageBlobRecord>(STORE_NAMES.imageBlobs),
      loadSettings(),
    ]);

  const manifest: BackupManifest = {
    app: "gpt-image-studio",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    excludes: ["apiKey"],
  };
  const data: BackupData = {
    conversations,
    messages,
    imageAssets: imageAssets.map(stripPreviewUrl),
    settings: settings ? stripApiKey(settings) : undefined,
  };
  const entries = [
    jsonEntry(MANIFEST_FILE, manifest),
    jsonEntry(DATA_FILE, data),
    ...imageBlobs.map((record) => ({
      name: blobEntryName(record.key),
      blob: record.blob,
    })),
  ];

  return createZipArchive(entries);
}

export async function restoreStudioBackup(file: File) {
  const files = await readZipFiles(file);
  const manifest = await readJsonFile<BackupManifest>(files, MANIFEST_FILE);
  const data = await readJsonFile<BackupData>(files, DATA_FILE);

  validateManifest(manifest);
  validateBackupData(data);
  validateImageBlobs(data, files);

  const currentSettings = await loadSettings();
  const restoredSettings = data.settings
    ? {
        ...data.settings,
        apiKey: currentSettings?.apiKey ?? "",
      }
    : currentSettings;

  await Promise.all([
    clearStore(STORE_NAMES.conversations),
    clearStore(STORE_NAMES.messages),
    clearStore(STORE_NAMES.imageAssets),
    clearStore(STORE_NAMES.imageBlobs),
    clearStore(STORE_NAMES.settings),
  ]);

  await Promise.all([
    ...data.conversations.map((conversation) =>
      putInStore(STORE_NAMES.conversations, conversation),
    ),
    ...data.messages.map((message) =>
      putInStore(STORE_NAMES.messages, message),
    ),
    ...data.imageAssets.map((asset) =>
      putInStore(STORE_NAMES.imageAssets, stripPreviewUrl(asset)),
    ),
    ...data.imageAssets.map(async (asset) => {
      if (!asset.blobKey) return;

      const blob = files.get(blobEntryName(asset.blobKey));
      if (!blob) return;

      await putInStore<ImageBlobRecord>(STORE_NAMES.imageBlobs, {
        key: asset.blobKey,
        blob: await restoreImageBlob(blob, asset),
      });
    }),
    restoredSettings
      ? saveSettings(restoredSettings)
      : Promise.resolve(),
  ]);
}

function jsonEntry(name: string, value: unknown) {
  return {
    name,
    blob: new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  };
}

function stripPreviewUrl(asset: ImageAsset): ImageAsset {
  const { previewUrl: _previewUrl, ...plainAsset } = asset;
  return plainAsset;
}

function stripApiKey(settings: AppSettings): Omit<AppSettings, "apiKey"> {
  const { apiKey: _apiKey, ...safeSettings } = settings;
  return safeSettings;
}

function blobEntryName(blobKey: string) {
  return `blobs/${encodeURIComponent(blobKey)}`;
}

async function readJsonFile<T>(files: ZipFileMap, name: string) {
  const file = files.get(name);
  if (!file) {
    throw new Error(`备份缺少 ${name}。`);
  }

  return JSON.parse(await file.text()) as T;
}

function validateManifest(manifest: BackupManifest) {
  if (manifest.app !== "gpt-image-studio") {
    throw new Error("这不是 GPT Image Studio 的备份文件。");
  }

  if (manifest.version !== BACKUP_VERSION) {
    throw new Error("备份版本不兼容。");
  }
}

function validateBackupData(data: BackupData) {
  if (
    !Array.isArray(data.conversations) ||
    !Array.isArray(data.messages) ||
    !Array.isArray(data.imageAssets)
  ) {
    throw new Error("备份数据结构不完整。");
  }
}

function validateImageBlobs(data: BackupData, files: ZipFileMap) {
  const missingBlob = data.imageAssets.find(
    (asset) => asset.blobKey && !files.has(blobEntryName(asset.blobKey)),
  );

  if (missingBlob?.blobKey) {
    throw new Error(`备份缺少图片文件：${missingBlob.blobKey}`);
  }
}

async function restoreImageBlob(blob: Blob, asset: ImageAsset) {
  return new Blob([await blob.arrayBuffer()], {
    type: asset.mimeType || blob.type || "application/octet-stream",
  });
}

async function readZipFiles(file: File): Promise<ZipFileMap> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files: ZipFileMap = new Map();
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    if (compressionMethod !== 0) {
      throw new Error("备份文件使用了暂不支持的压缩格式。");
    }

    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, filenameLength));
    const blob = new Blob([buffer.slice(dataStart, dataEnd)]);

    files.set(name, blob);
    offset = dataEnd;
  }

  return files;
}
