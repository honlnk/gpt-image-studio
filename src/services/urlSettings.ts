import type { AppSettings } from "../types/studio";

const URL_SETTING_KEYS = [
  "apiBaseUrl",
  "apiUrl",
  "apiKey",
  "model",
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
  const apiKey = searchParams.get("apiKey");
  const model = searchParams.get("model");

  if (apiBaseUrl !== null) patch.apiBaseUrl = apiBaseUrl.trim();
  if (apiKey !== null) patch.apiKey = apiKey.trim();
  if (model !== null && model.trim()) patch.model = model.trim();

  return patch;
}

export type { UrlSettingKey };
