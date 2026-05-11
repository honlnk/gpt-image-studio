import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../types/studio";
import { loadSettings, saveSettings } from "./settings";
import { STORE_NAMES } from "./db";

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
  defaults: {
    size: "1024x1024",
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

  it("defaults old settings to direct connection mode", async () => {
    const { connectionMode: _ignored, ...legacySettings } = fullSettings;
    mocks.getFromStore.mockResolvedValue({
      key: "app",
      value: legacySettings,
    });

    const result = await loadSettings();

    expect(result?.connectionMode).toBe("direct");
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
