import type { AppSettings } from "../types/studio";

const URL_SETTING_KEYS = [
  "apiBaseUrl",
  "apiUrl",
  "apiKey",
  "model",
  "apiBaseUrlMode",
] as const;

type UrlSettingKey = typeof URL_SETTING_KEYS[number];

export function hasUrlSettingParams(searchParams: URLSearchParams) {
  return URL_SETTING_KEYS.some((key) => searchParams.has(key));
}

export function clearUrlSettingParams(searchParams: URLSearchParams) {
  for (const key of URL_SETTING_KEYS) {
    searchParams.delete(key);
  }
}

export function buildSettingsFromUrlParams(
  currentSettings: AppSettings,
  searchParams: URLSearchParams,
): AppSettings | null {
  const patch = getQuerySettingsPatch(searchParams);

  if (Object.keys(patch).length === 0) return null;

  return {
    ...currentSettings,
    ...patch,
  };
}

export async function applyUrlSettings(
  currentSettings: AppSettings,
  saveSettings: (settings: AppSettings) => Promise<void>,
  applySettings: (settings: AppSettings) => void,
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "replaceState"> = window.history,
) {
  const searchParams = new URLSearchParams(location.search);
  const nextSettings = buildSettingsFromUrlParams(currentSettings, searchParams);
  if (!nextSettings) return false;

  applySettings(nextSettings);
  await saveSettings(nextSettings);

  clearUrlSettingParams(searchParams);
  const nextSearch = searchParams.toString();
  const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`;
  history.replaceState(null, "", nextUrl);

  return true;
}

function getQuerySettingsPatch(searchParams: URLSearchParams): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {};
  const apiBaseUrl = searchParams.get("apiBaseUrl") ?? searchParams.get("apiUrl");
  const apiBaseUrlMode = normalizeApiBaseUrlMode(searchParams.get("apiBaseUrlMode"));
  const apiKey = searchParams.get("apiKey");
  const model = searchParams.get("model");

  if (apiBaseUrl !== null) {
    patch.apiBaseUrlMode = apiBaseUrlMode ?? "origin";
    patch.apiBaseUrl = patch.apiBaseUrlMode === "origin"
      ? stripImagesApiPath(apiBaseUrl)
      : apiBaseUrl.trim();
  } else if (apiBaseUrlMode) {
    patch.apiBaseUrlMode = apiBaseUrlMode;
  }
  if (apiKey !== null) patch.apiKey = apiKey.trim();
  if (model !== null && model.trim()) patch.model = model.trim();

  return patch;
}

function normalizeApiBaseUrlMode(value: unknown): "origin" | "full" | undefined {
  return value === "origin" || value === "full" ? value : undefined;
}

function stripImagesApiPath(apiBaseUrl: string) {
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1\/images$/i, "");
}

export type { UrlSettingKey };
