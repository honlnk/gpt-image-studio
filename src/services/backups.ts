import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  normalizePromptRewriteGuardText,
} from "./promptRewriteGuard";
import { normalizeFavoritePrompts } from "./favoritePrompts";
import { normalizePromptWordbanks } from "./promptWordbanks";
import type { AppSettings, Conversation, ImageAsset, Message } from "../types/studio";
import {
  STORE_NAMES,
  type ImageBlobRecord,
  type StudioStorage,
} from "./storage";
import { resolveStorage } from "./storage/resolveStorage";
import { saveSettings, loadSettings } from "./settings";
import { createZipArchive } from "./zipArchive";
import { readStorage, writeStorage } from "../shared/localStorage";

const BACKUP_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const DATA_FILE = "data.json";
/** companionUrl 的权威存储（与 settingsStore 的 SETTINGS_STORAGE_KEYS.companionUrl 一致）。 */
const COMPANION_URL_MIRROR_KEY = "gpt-image-studio:companion-url";

type BackupManifest = {
  app: "gpt-image-studio";
  version: number;
  exportedAt: string;
  excludes: string[];
};

type BackupData = {
  conversations: Conversation[];
  messages: StoredMessage[];
  imageAssets: ImageAsset[];
  settings?: StoredBackupSettings;
  /** 阶段一 PR5：companion 连接配置进备份（跨设备迁移需要 URL）。
   *  companionAccessKey 在导出时剥离（stripCompanionCredentials），到新设备重新配对。 */
  companionUrl?: string;
  companionAccessKey?: string;
};

type ZipFileMap = Map<string, Blob>;
type StoredMessage = Omit<Message, "generationParams"> & {
  generationParams?: StoredGenerationParams;
};
type StoredBackupSettings = Omit<
  AppSettings,
  | "apiKey"
  | "defaults"
  | "promptMode"
  | "promptWordbanks"
  | "promptRewriteGuardEnabled"
  | "promptRewriteGuardText"
  | "promptRewriteGuardHistory"
  | "favoritePrompts"
  | "analyticsEnabled"
  | "analyticsPromptCapture"
> & {
  promptRewriteGuardEnabled?: boolean;
  promptRewriteGuardText?: string;
  promptRewriteGuardHistory?: AppSettings["promptRewriteGuardHistory"];
  favoritePrompts?: unknown;
  promptMode?: AppSettings["promptMode"];
  promptWordbanks?: unknown;
  analyticsEnabled?: boolean;
  analyticsPromptCapture?: AppSettings["analyticsPromptCapture"];
  defaults: StoredGenerationParams;
};

/** 备份/恢复服务（跨 5 collection 的整库操作）。阶段一 PR3 改工厂注入（决策 T1）。 */
export type BackupServices = ReturnType<typeof createBackupServices>;

export function createBackupServices(storage: StudioStorage) {
  return {
    async create() {
      const [conversations, messages, imageAssets, imageBlobs, settings] =
        await Promise.all([
          storage.list<Conversation>(STORE_NAMES.conversations),
          storage.list<Message>(STORE_NAMES.messages),
          storage.list<ImageAsset>(STORE_NAMES.imageAssets),
          storage.list<ImageBlobRecord>(STORE_NAMES.imageBlobs),
          loadSettings(),
        ]);
      // companionUrl 的权威存储是 localStorage 镜像（T3 回滚后）。
      // 不再回查旧 config——PR5 从未发布到 main，没有真实用户在 config 里留有此键。
      const companionUrl = readStorage(COMPANION_URL_MIRROR_KEY, "");

      const manifest: BackupManifest = {
        app: "gpt-image-studio",
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        excludes: ["apiKey", "companionAccessKey"],
      };
      const data: BackupData = {
        conversations,
        messages,
        imageAssets: imageAssets.map(stripPreviewUrl),
        settings: settings ? stripApiKey(settings) : undefined,
        // companionUrl 进备份（跨设备迁移需要），accessKey 剥离（敏感，不导出）。
        companionUrl: companionUrl ?? undefined,
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
    },

    async restore(file: File) {
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
            promptMode: data.settings.promptMode ?? "default",
            promptWordbanks: normalizePromptWordbanks(data.settings.promptWordbanks),
            promptRewriteGuardEnabled:
              data.settings.promptRewriteGuardEnabled ?? true,
            promptRewriteGuardText: normalizePromptRewriteGuardText(
              data.settings.promptRewriteGuardText,
            ),
            promptRewriteGuardHistory:
              data.settings.promptRewriteGuardHistory ?? [
                {
                  id: "prompt-guard-default",
                  text: PROMPT_REWRITE_GUARD_PREFIX,
                  createdAt: new Date(0).toISOString(),
                },
              ],
            favoritePrompts: normalizeFavoritePrompts(data.settings.favoritePrompts),
            defaults: normalizeGenerationParams(data.settings.defaults),
            autoRetryOnNetworkError:
              data.settings.autoRetryOnNetworkError ?? false,
            analyticsEnabled: data.settings.analyticsEnabled ?? true,
            analyticsPromptCapture:
              data.settings.analyticsPromptCapture ?? "length_only",
          }
        : currentSettings;

      await Promise.all([
        storage.clear(STORE_NAMES.conversations),
        storage.clear(STORE_NAMES.messages),
        storage.clear(STORE_NAMES.imageAssets),
        storage.clear(STORE_NAMES.imageBlobs),
        storage.clear(STORE_NAMES.settings),
      ]);

      await Promise.all([
        ...data.conversations.map((conversation) =>
          storage.put(STORE_NAMES.conversations, conversation),
        ),
        ...data.messages.map((message) =>
          storage.put(STORE_NAMES.messages, normalizeMessage(message)),
        ),
        ...data.imageAssets.map((asset) =>
          storage.put(STORE_NAMES.imageAssets, stripPreviewUrl(asset)),
        ),
        ...data.imageAssets.map(async (asset) => {
          if (!asset.blobKey) return;

          const blob = files.get(blobEntryName(asset.blobKey));
          if (!blob) return;

          await storage.put<ImageBlobRecord>(STORE_NAMES.imageBlobs, {
            key: asset.blobKey,
            blob: await restoreImageBlob(blob, asset),
          });
        }),
        restoredSettings
          ? saveSettings(restoredSettings)
          : Promise.resolve(),
        // 恢复 companionUrl 到 localStorage 镜像（权威存储，T3 回滚后不再写 config），
        // 镜像值由随后 restoreFromStorage 的凭据迁移同步进 ref。accessKey 备份里被剥离。
        data.companionUrl
          ? Promise.resolve(writeStorage(COMPANION_URL_MIRROR_KEY, data.companionUrl))
          : Promise.resolve(),
      ]);
    },
  };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultBackupServices = createBackupServices(resolveStorage());

export async function createStudioBackup() {
  return defaultBackupServices.create();
}

export async function restoreStudioBackup(file: File) {
  return defaultBackupServices.restore(file);
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

function normalizeMessage(message: StoredMessage): Message {
  return {
    ...message,
    generationParams: message.generationParams
      ? normalizeGenerationParams(message.generationParams)
      : undefined,
  };
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
