import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../types/studio";
import {
  createSpyStorage,
  type SpyStorage,
} from "./storage/createSpyStorage";
import { PROMPT_REWRITE_GUARD_PREFIX } from "./imagesApi";
import { defaultPromptWordbanks } from "./promptWordbanks";

const spyStorage: SpyStorage = createSpyStorage();

vi.mock("./storage/resolveStorage", () => ({
  resolveStorage: () => spyStorage,
}));

const { loadSettings, saveSettings } = await import("./settings");
const { STORE_NAMES } = await import("./storage");

const fullSettings: AppSettings = {
  connectionMode: "direct",
  apiKey: "sk-test",
  apiBaseUrl: "https://api.packyapi.com/v1/images",
  apiBaseUrlMode: "full",
  apiMode: "images",
  streamImages: false,
  streamPartialImages: 1,
  model: "gpt-image-2",
  directModel: "gpt-image-2.5-flare",
  promptMode: "default",
  promptWordbanks: defaultPromptWordbanks,
  promptRewriteGuardEnabled: true,
  promptRewriteGuardText: PROMPT_REWRITE_GUARD_PREFIX,
  promptRewriteGuardHistory: [
    {
      id: "prompt-guard-default",
      text: PROMPT_REWRITE_GUARD_PREFIX,
      createdAt: "1970-01-01T00:00:00.000Z",
    },
  ],
  favoritePrompts: [],
  defaults: {
    size: "1:1",
    resolution: "1k",
    width: 1024,
    height: 1024,
    imageCount: 1,
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  },
  autoRetryOnNetworkError: false,
  analyticsEnabled: true,
  analyticsPromptCapture: "length_only",
  storageMode: "indexeddb",
};

describe("settings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads settings with connection mode", async () => {
    spyStorage.get.mockResolvedValue({
      key: "app",
      value: fullSettings,
    });

    const result = await loadSettings();

    expect(spyStorage.get).toHaveBeenCalledWith(STORE_NAMES.settings, "app");
    expect(result).toEqual(fullSettings);
  });

  it("defaults old settings to direct connection mode and enabled prompt guard", async () => {
    const {
      connectionMode: _ignoredConnectionMode,
      apiBaseUrlMode: _ignoredApiBaseUrlMode,
      apiMode: _ignoredApiMode,
      streamImages: _ignoredStreamImages,
      streamPartialImages: _ignoredStreamPartialImages,
      promptRewriteGuardEnabled: _ignoredPromptRewriteGuardEnabled,
      promptRewriteGuardText: _ignoredPromptRewriteGuardText,
      promptRewriteGuardHistory: _ignoredPromptRewriteGuardHistory,
      favoritePrompts: _ignoredFavoritePrompts,
      promptMode: _ignoredPromptMode,
      promptWordbanks: _ignoredPromptWordbanks,
      ...legacySettings
    } = fullSettings;
    spyStorage.get.mockResolvedValue({
      key: "app",
      value: legacySettings,
    });

    const result = await loadSettings();

    expect(result?.connectionMode).toBe("direct");
    expect(result?.apiBaseUrlMode).toBe("origin");
    expect(result?.apiMode).toBe("images");
    expect(result?.streamImages).toBe(false);
    expect(result?.streamPartialImages).toBe(1);
    expect(result?.promptMode).toBe("default");
    expect(result?.promptWordbanks).toEqual(defaultPromptWordbanks);
    expect(result?.promptRewriteGuardEnabled).toBe(true);
    expect(result?.promptRewriteGuardText).toBe(PROMPT_REWRITE_GUARD_PREFIX);
    expect(result?.promptRewriteGuardHistory).toEqual([
      {
        id: "prompt-guard-default",
        text: PROMPT_REWRITE_GUARD_PREFIX,
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    ]);
    expect(result?.favoritePrompts).toEqual([]);
  });

  it("normalizes any stored custom model back to gpt-image-2", async () => {
    spyStorage.get.mockResolvedValue({
      key: "app",
      value: {
        ...fullSettings,
        model: "custom-model",
        directModel: "custom-model",
      },
    });

    const result = await loadSettings();

    expect(result?.model).toBe("gpt-image-2");
    // 直连模型只接受 DIRECT_IMAGE_MODEL_OPTIONS 内的值，非法值回退 gpt-image-2。
    expect(result?.directModel).toBe("gpt-image-2");
  });

  it("saves settings record", async () => {
    await saveSettings(fullSettings);

    expect(spyStorage.put).toHaveBeenCalledWith(STORE_NAMES.settings, {
      key: "app",
      // saveSettings 内部会把 model 规范化为 FIXED_IMAGE_MODEL
      value: expect.objectContaining({
        ...fullSettings,
        model: expect.any(String),
      }),
    });
  });
});
