import { describe, expect, it, vi } from "vitest";
import { PROMPT_REWRITE_GUARD_PREFIX } from "./imagesApi";
import {
  applyUrlSettings,
  buildSettingsFromUrlParams,
  clearUrlSettingParams,
  hasUrlSettingParams,
} from "./urlSettings";
import type { AppSettings } from "../types/studio";

const currentSettings: AppSettings = {
  connectionMode: "direct",
  apiKey: "sk-current",
  apiBaseUrl: "https://api.packyapi.com/v1/images",
  apiBaseUrlMode: "full",
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

describe("URL settings", () => {
  it("builds settings from simple embed query params", () => {
    const params = new URLSearchParams(
      "apiUrl=https://proxy.example.com/v1/images&apiKey=sk-url&model=gpt-image-1",
    );

    const next = buildSettingsFromUrlParams(currentSettings, params);

    expect(next).toMatchObject({
      apiBaseUrl: "https://proxy.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "sk-url",
      model: "gpt-image-1",
      connectionMode: "direct",
    });
    expect(next?.defaults).toEqual(currentSettings.defaults);
  });

  it("normalizes URL API origins with extra trailing slashes", () => {
    const params = new URLSearchParams(
      "apiUrl=https://proxy.example.com///&apiKey=sk-url",
    );

    const next = buildSettingsFromUrlParams(currentSettings, params);

    expect(next).toMatchObject({
      apiBaseUrl: "https://proxy.example.com",
      apiBaseUrlMode: "origin",
    });
  });

  it("keeps the full API base URL when explicitly requested", () => {
    const params = new URLSearchParams(
      "apiUrl=https://proxy.example.com/v1/images&apiBaseUrlMode=full",
    );

    const next = buildSettingsFromUrlParams(currentSettings, params);

    expect(next).toMatchObject({
      apiBaseUrl: "https://proxy.example.com/v1/images",
      apiBaseUrlMode: "full",
    });
  });

  it("clears known URL settings without removing unrelated params", () => {
    const params = new URLSearchParams(
      "apiKey=sk-url&model=x&settings=ignored&connectionMode=localCompanion&foo=bar",
    );

    expect(hasUrlSettingParams(params)).toBe(true);
    clearUrlSettingParams(params);

    expect(params.toString()).toBe("settings=ignored&connectionMode=localCompanion&foo=bar");
  });

  it("applies URL settings, saves them, and removes sensitive params from the URL", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const applySettings = vi.fn();
    const replaceState = vi.fn();

    const applied = await applyUrlSettings(
      currentSettings,
      saveSettings,
      applySettings,
      {
        pathname: "/studio",
        search: "?apiKey=sk-url&model=gpt-image-1&view=embed",
        hash: "#chat",
      },
      { replaceState },
    );

    expect(applied).toBe(true);
    expect(applySettings).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-url",
      model: "gpt-image-1",
    }));
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-url",
      model: "gpt-image-1",
    }));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/studio?view=embed#chat");
  });
});
