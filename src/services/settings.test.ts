import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../types/studio";
import { loadSettings, saveSettings } from "./settings";
import { STORE_NAMES } from "./db";
import { PROMPT_REWRITE_GUARD_PREFIX } from "./imagesApi";

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
  apiBaseUrl: "https://api.openai.com/v1/images",
  model: "gpt-image-2",
  promptRewriteGuardEnabled: true,
  promptRewriteGuardText: PROMPT_REWRITE_GUARD_PREFIX,
  promptRewriteGuardHistory: [
    {
      id: "prompt-guard-default",
      text: PROMPT_REWRITE_GUARD_PREFIX,
      createdAt: "1970-01-01T00:00:00.000Z",
    },
  ],
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
      promptRewriteGuardEnabled: _ignoredPromptRewriteGuardEnabled,
      promptRewriteGuardText: _ignoredPromptRewriteGuardText,
      promptRewriteGuardHistory: _ignoredPromptRewriteGuardHistory,
      ...legacySettings
    } = fullSettings;
    mocks.getFromStore.mockResolvedValue({
      key: "app",
      value: legacySettings,
    });

    const result = await loadSettings();

    expect(result?.connectionMode).toBe("direct");
    expect(result?.promptRewriteGuardEnabled).toBe(true);
    expect(result?.promptRewriteGuardText).toBe(PROMPT_REWRITE_GUARD_PREFIX);
    expect(result?.promptRewriteGuardHistory).toEqual([
      {
        id: "prompt-guard-default",
        text: PROMPT_REWRITE_GUARD_PREFIX,
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    ]);
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
