import { describe, expect, it, vi } from "vitest";
import { PROMPT_REWRITE_GUARD_PREFIX } from "./imagesApi";
import {
  applyUrlSettings,
  buildSettingsFromUrlParams,
  clearUrlSettingParams,
  getPromptFromUrlParams,
  hasUrlSettingParams,
  hasUrlGenerationParams,
} from "./urlSettings";
import type { AppSettings } from "../types/studio";
import { defaultPromptWordbanks } from "./promptWordbanks";

const currentSettings: AppSettings = {
  connectionMode: "direct",
  apiKey: "sk-current",
  apiBaseUrl: "https://api.packyapi.com/v1/images",
  apiBaseUrlMode: "full",
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

  it("builds settings from a JSON settings param", () => {
    const params = new URLSearchParams();
    params.set("settings", JSON.stringify({
      apiUrl: "https://settings.example.com",
      apiKey: "sk-settings",
      model: "gpt-image-2",
      size: "16:9",
      resolution: "2k",
      background: "opaque",
      outputFormat: "webp",
      promptRewriteGuard: false,
      promptRewriteGuardText: "不要改写：",
    }));

    const next = buildSettingsFromUrlParams(currentSettings, params);

    expect(next).toMatchObject({
      apiBaseUrl: "https://settings.example.com",
      apiBaseUrlMode: "origin",
      apiKey: "sk-settings",
      model: "gpt-image-2",
      promptRewriteGuardEnabled: false,
      promptRewriteGuardText: "不要改写：",
      defaults: {
        ...currentSettings.defaults,
        size: "16:9",
        resolution: "2k",
        background: "opaque",
        outputFormat: "webp",
      },
    });
  });

  it("lets independent params override values from the JSON settings param", () => {
    const params = new URLSearchParams();
    params.set("settings", JSON.stringify({
      apiUrl: "https://settings.example.com",
      apiKey: "sk-settings",
      model: "gpt-image-1",
      defaults: {
        size: "1:1",
        resolution: "1k",
        background: "opaque",
      },
    }));
    params.set("apiUrl", "https://query.example.com/v1/images");
    params.set("apiKey", "sk-query");
    params.set("model", "gpt-image-2");
    params.set("size", "9:16");
    params.set("resolution", "4k");
    params.set("background", "transparent");

    const next = buildSettingsFromUrlParams(currentSettings, params);

    expect(next).toMatchObject({
      apiBaseUrl: "https://query.example.com",
      apiKey: "sk-query",
      model: "gpt-image-2",
      defaults: expect.objectContaining({
        size: "9:16",
        resolution: "4k",
        background: "transparent",
      }),
    });
  });

  it("reads prompt from settings and lets the independent prompt override it", () => {
    const params = new URLSearchParams();
    params.set("settings", JSON.stringify({ prompt: "settings prompt" }));

    expect(getPromptFromUrlParams(params)).toBe("settings prompt");

    params.set("prompt", "query prompt");
    expect(getPromptFromUrlParams(params)).toBe("query prompt");
  });

  it("detects generation params in both settings and independent params", () => {
    const settingsParams = new URLSearchParams();
    settingsParams.set("settings", JSON.stringify({ defaults: { size: "16:9" } }));

    expect(hasUrlGenerationParams(settingsParams)).toBe(true);
    expect(hasUrlGenerationParams(new URLSearchParams("size=9%3A16"))).toBe(true);
    expect(hasUrlGenerationParams(new URLSearchParams("model=gpt-image-2"))).toBe(false);
  });

  it("clears known URL settings without removing unrelated params", () => {
    const params = new URLSearchParams(
      "apiKey=sk-url&model=x&settings=ignored&prompt=hello&connectionMode=localCompanion&foo=bar",
    );

    expect(hasUrlSettingParams(params)).toBe(true);
    clearUrlSettingParams(params);

    expect(params.toString()).toBe("connectionMode=localCompanion&foo=bar");
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
