import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, Conversation, ImageAsset, Message } from "../types/studio";
import { createStudioBackup, restoreStudioBackup } from "./backups";
import { STORE_NAMES } from "./db";
import { createZipArchive } from "./zipArchive";

const mocks = vi.hoisted(() => ({
  clearStore: vi.fn(),
  getAllFromStore: vi.fn(),
  loadSettings: vi.fn(),
  putInStore: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    clearStore: mocks.clearStore,
    getAllFromStore: mocks.getAllFromStore,
    putInStore: mocks.putInStore,
  };
});

vi.mock("./settings", () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
}));

const conversation: Conversation = {
  id: "conversation-1",
  title: "测试对话",
  summary: "摘要",
  updatedAt: "2026-05-07T00:00:00.000Z",
};

const message: Message = {
  id: "message-1",
  conversationId: conversation.id,
  role: "assistant",
  content: "生成完成",
  referencedImageIds: [],
  resultImageIds: ["image-1"],
  status: "success",
  createdAt: "2026-05-07T00:01:00.000Z",
};

const imageAsset: ImageAsset = {
  id: "image-1",
  blobKey: "blob 1",
  name: "图片",
  source: "generated",
  mimeType: "image/png",
  sizeBytes: 10,
  conversationId: conversation.id,
  messageId: message.id,
  prompt: "画一张图",
  createdAt: "2026-05-07T00:02:00.000Z",
  previewUrl: "blob:http://localhost/preview",
};

const settings: AppSettings = {
  connectionMode: "direct",
  apiKey: "sk-secret",
  apiBaseUrl: "https://api.example.test/v1/images",
  model: "gpt-image-1",
  defaults: {
    size: "1:1",
    resolution: "1k",
    width: 1024,
    height: 1024,
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  },
  storageMode: "indexeddb",
};

describe("studio backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearStore.mockResolvedValue(undefined);
    mocks.putInStore.mockResolvedValue(undefined);
    mocks.saveSettings.mockResolvedValue(undefined);
  });

  it("exports manifest, data, and blobs without API key or preview URLs", async () => {
    mocks.getAllFromStore.mockImplementation((storeName: string) => {
      if (storeName === STORE_NAMES.conversations) return [conversation];
      if (storeName === STORE_NAMES.messages) return [message];
      if (storeName === STORE_NAMES.imageAssets) return [imageAsset];
      if (storeName === STORE_NAMES.imageBlobs) {
        return [{ key: imageAsset.blobKey, blob: new Blob(["image-data"]) }];
      }
      return [];
    });
    mocks.loadSettings.mockResolvedValue(settings);

    const backup = await createStudioBackup();
    const files = await readLocalZipFiles(backup);
    const manifest = JSON.parse(await files.get("manifest.json")!.text());
    const data = JSON.parse(await files.get("data.json")!.text());

    expect(manifest).toMatchObject({
      app: "gpt-image-studio",
      version: 1,
      excludes: ["apiKey"],
    });
    expect(data.settings).toEqual({
      connectionMode: settings.connectionMode,
      apiBaseUrl: settings.apiBaseUrl,
      model: settings.model,
      defaults: settings.defaults,
      storageMode: settings.storageMode,
    });
    expect(JSON.stringify(data)).not.toContain("sk-secret");
    expect(data.imageAssets[0]).not.toHaveProperty("previewUrl");
    expect(await files.get("blobs/blob%201")!.text()).toBe("image-data");
  });

  it("rejects backups from another app before clearing existing stores", async () => {
    const backup = await zipBackup({
      manifest: {
        app: "other-app",
        version: 1,
        exportedAt: "2026-05-07T00:00:00.000Z",
        excludes: ["apiKey"],
      },
      data: {
        conversations: [],
        messages: [],
        imageAssets: [],
      },
    });

    await expect(restoreStudioBackup(fileFromBlob(backup))).rejects.toThrow(
      "这不是 GPT Image Studio 的备份文件。",
    );
    expect(mocks.clearStore).not.toHaveBeenCalled();
  });

  it("rejects missing image blob files before clearing existing stores", async () => {
    const backup = await zipBackup({
      data: {
        conversations: [],
        messages: [],
        imageAssets: [{ ...imageAsset, previewUrl: undefined }],
      },
    });

    await expect(restoreStudioBackup(fileFromBlob(backup))).rejects.toThrow(
      "备份缺少图片文件：blob 1",
    );
    expect(mocks.clearStore).not.toHaveBeenCalled();
  });

  it("restores records and preserves the current API key", async () => {
    const backup = await zipBackup({
      data: {
        conversations: [conversation],
        messages: [message],
        imageAssets: [{ ...imageAsset, previewUrl: undefined }],
        settings: {
          connectionMode: settings.connectionMode,
          apiBaseUrl: settings.apiBaseUrl,
          model: settings.model,
          defaults: settings.defaults,
          storageMode: settings.storageMode,
        },
      },
      blobs: [{ name: "blobs/blob%201", content: "image-data" }],
    });
    mocks.loadSettings.mockResolvedValue({ ...settings, apiKey: "sk-current" });

    await restoreStudioBackup(fileFromBlob(backup));

    expect(mocks.clearStore).toHaveBeenCalledTimes(5);
    expect(mocks.putInStore).toHaveBeenCalledWith(
      STORE_NAMES.conversations,
      conversation,
    );
    expect(mocks.putInStore).toHaveBeenCalledWith(STORE_NAMES.messages, message);
    expect(mocks.putInStore).toHaveBeenCalledWith(
      STORE_NAMES.imageAssets,
      expect.not.objectContaining({ previewUrl: expect.anything() }),
    );
    expect(mocks.putInStore).toHaveBeenCalledWith(
      STORE_NAMES.imageBlobs,
      expect.objectContaining({
        key: "blob 1",
        blob: expect.any(Blob),
      }),
    );
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      ...settings,
      apiKey: "sk-current",
    });
  });
});

async function zipBackup({
  manifest = {
    app: "gpt-image-studio",
    version: 1,
    exportedAt: "2026-05-07T00:00:00.000Z",
    excludes: ["apiKey"],
  },
  data,
  blobs = [],
}: {
  manifest?: unknown;
  data: unknown;
  blobs?: { name: string; content: string }[];
}) {
  return createZipArchive([
    jsonEntry("manifest.json", manifest),
    jsonEntry("data.json", data),
    ...blobs.map((blob) => ({
      name: blob.name,
      blob: new Blob([blob.content], { type: "image/png" }),
    })),
  ]);
}

function jsonEntry(name: string, value: unknown) {
  return {
    name,
    blob: new Blob([JSON.stringify(value)], { type: "application/json" }),
  };
}

function fileFromBlob(blob: Blob) {
  return new File([blob], "backup.zip", { type: "application/zip" });
}

async function readLocalZipFiles(zip: Blob) {
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, Blob>();
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, filenameLength));

    files.set(name, new Blob([buffer.slice(dataStart, dataEnd)]));
    offset = dataEnd;
  }

  return files;
}
