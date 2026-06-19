import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../types/studio";
import { loadSettings, saveSettings } from "./settings";
import { STORE_NAMES } from "./db";
import { PROMPT_REWRITE_GUARD_PREFIX } from "./imagesApi";
import { defaultPromptWordbanks } from "./promptWordbanks";

const mocks = vi.hoisted(() => ({
  getFromStore: vi.fn(),
  putInStore: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getFromStore: mocks.getFromStore,
    putInStore: mocks.putInStore,
  };
});

const fullSettings: AppSettings = {
  connectionMode: "direct",
  apiKey: "sk-test",
  apiBaseUrl: "https://api.packyapi.com/v1/images",
  apiBaseUrlMode: "full",
  apiMode: "images",
  streamImages: false,
  streamPartialImages: 1,
  model: "gpt-image-2",
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
    mocks.getFromStore.mockResolvedValue({
      key: "app",
      value: fullSettings,
    });

    const result = await loadSettings();

    expect(mocks.getFromStore).toHaveBeenCalledWith(STORE_NAMES.settings, "app");
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
    mocks.getFromStore.mockResolvedValue({
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
    mocks.getFromStore.mockResolvedValue({
      key: "app",
      value: {
        ...fullSettings,
        model: "custom-model",
      },
    });

    const result = await loadSettings();

    expect(result?.model).toBe("gpt-image-2");
  });

  it("saves settings record", async () => {
    mocks.putInStore.mockResolvedValue(undefined);

    await saveSettings(fullSettings);

    expect(mocks.putInStore).toHaveBeenCalledWith(STORE_NAMES.settings, {
      key: "app",
      value: fullSettings,
    });
  });
});
