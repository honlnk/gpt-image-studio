import type {
  ApiBaseUrlMode,
  AppSettings,
  GenerationParams,
  SizeResolution,
} from "../types/studio";

const URL_SETTING_KEYS = [
  "settings",
  "apiBaseUrl",
  "apiUrl",
  "apiKey",
  "model",
  "apiBaseUrlMode",
  "prompt",
  "promptRewriteGuard",
  "promptRewriteGuardEnabled",
  "promptRewriteGuardText",
  "size",
  "resolution",
  "width",
  "height",
  "background",
  "outputFormat",
] as const;

type UrlSettingKey = typeof URL_SETTING_KEYS[number];
type SettingsPatch = Partial<Omit<AppSettings, "defaults">> & {
  defaults?: Partial<GenerationParams>;
};
type SettingsPayload = Record<string, unknown>;

const SIZE_VALUES = [
  "auto",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "3:4",
  "2:3",
  "9:16",
  "custom",
] as const;
const RESOLUTION_VALUES = ["1k", "2k", "4k"] as const;
const BACKGROUND_VALUES = ["auto", "opaque", "transparent"] as const;
const OUTPUT_FORMAT_VALUES = ["png", "webp", "jpeg"] as const;

export function hasUrlSettingParams(searchParams: URLSearchParams) {
  return URL_SETTING_KEYS.some((key) => searchParams.has(key));
}

export function hasUrlGenerationParams(searchParams: URLSearchParams) {
  const payload = parseSettingsPayload(searchParams.get("settings"));
  return Boolean(
    settingsPatchHasKeys(getGenerationPatchFromPayload(payload)) ||
      settingsPatchHasKeys(getGenerationPatchFromSearchParams(searchParams)),
  );
}

export function getPromptFromUrlParams(searchParams: URLSearchParams) {
  const payload = parseSettingsPayload(searchParams.get("settings"));
  const settingsPrompt = readString(payload, "prompt");
  const queryPrompt = searchParams.get("prompt");
  return queryPrompt !== null ? queryPrompt : settingsPrompt;
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
  const settingsPatch = getSettingsPatchFromPayload(
    parseSettingsPayload(searchParams.get("settings")),
  );
  const queryPatch = getQuerySettingsPatch(searchParams);
  const patch = mergeSettingsPatches(currentSettings, settingsPatch, queryPatch);

  if (!settingsPatchHasKeys(patch)) return null;

  return {
    ...currentSettings,
    ...patch,
    defaults: {
      ...currentSettings.defaults,
      ...patch.defaults,
    },
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
  const hasKnownParams = hasUrlSettingParams(searchParams);
  const nextSettings = buildSettingsFromUrlParams(currentSettings, searchParams);
  if (nextSettings) {
    applySettings(nextSettings);
    await saveSettings(nextSettings);
  } else if (!hasKnownParams) {
    return false;
  }

  clearUrlSettingParams(searchParams);
  const nextSearch = searchParams.toString();
  const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`;
  history.replaceState(null, "", nextUrl);

  return Boolean(nextSettings);
}

function getSettingsPatchFromPayload(payload: SettingsPayload | null): SettingsPatch {
  return mergeSettingsPatches(
    {} as AppSettings,
    getApiSettingsPatchFromPayload(payload),
    getGenerationPatchFromPayload(payload),
    getPromptRewriteGuardPatchFromPayload(payload),
  );
}

function getApiSettingsPatchFromPayload(payload: SettingsPayload | null): SettingsPatch {
  const patch: SettingsPatch = {};
  const apiBaseUrl = readString(payload, "apiBaseUrl", "apiUrl");
  const apiBaseUrlMode = normalizeApiBaseUrlMode(readString(payload, "apiBaseUrlMode"));
  const apiKey = readString(payload, "apiKey");
  const model = readString(payload, "model");

  if (apiBaseUrl !== undefined) {
    patch.apiBaseUrlMode = apiBaseUrlMode ?? "origin";
    patch.apiBaseUrl = patch.apiBaseUrlMode === "origin"
      ? stripImagesApiPath(apiBaseUrl)
      : apiBaseUrl.trim();
  } else if (apiBaseUrlMode) {
    patch.apiBaseUrlMode = apiBaseUrlMode;
  }
  if (apiKey !== undefined) patch.apiKey = apiKey.trim();
  if (model?.trim()) patch.model = model.trim();

  return patch;
}

function getGenerationPatchFromPayload(payload: SettingsPayload | null): SettingsPatch {
  const defaultsPayload = isRecord(payload?.defaults) ? payload.defaults : null;
  return mergeSettingsPatches(
    {} as AppSettings,
    getGenerationPatchFromRecord(defaultsPayload),
    getGenerationPatchFromRecord(payload),
  );
}

function getPromptRewriteGuardPatchFromPayload(payload: SettingsPayload | null): SettingsPatch {
  const patch: SettingsPatch = {};
  const enabled = normalizeBoolean(
    readUnknown(payload, "promptRewriteGuardEnabled") ??
      readUnknown(payload, "promptRewriteGuard"),
  );
  const text = readString(payload, "promptRewriteGuardText");

  if (enabled !== undefined) patch.promptRewriteGuardEnabled = enabled;
  if (text?.trim()) patch.promptRewriteGuardText = text.trim();

  return patch;
}

function getQuerySettingsPatch(searchParams: URLSearchParams): SettingsPatch {
  return mergeSettingsPatches(
    {} as AppSettings,
    getApiSettingsPatchFromSearchParams(searchParams),
    getGenerationPatchFromSearchParams(searchParams),
    getPromptRewriteGuardPatchFromSearchParams(searchParams),
  );
}

function getApiSettingsPatchFromSearchParams(searchParams: URLSearchParams): SettingsPatch {
  const patch: SettingsPatch = {};
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

function getGenerationPatchFromSearchParams(searchParams: URLSearchParams): SettingsPatch {
  const source = Object.fromEntries(searchParams.entries());
  return getGenerationPatchFromRecord(source);
}

function getPromptRewriteGuardPatchFromSearchParams(searchParams: URLSearchParams): SettingsPatch {
  const patch: SettingsPatch = {};
  const enabled = normalizeBoolean(
    searchParams.get("promptRewriteGuardEnabled") ??
      searchParams.get("promptRewriteGuard"),
  );
  const text = searchParams.get("promptRewriteGuardText");

  if (enabled !== undefined) patch.promptRewriteGuardEnabled = enabled;
  if (text?.trim()) patch.promptRewriteGuardText = text.trim();

  return patch;
}

function getGenerationPatchFromRecord(source: SettingsPayload | null): SettingsPatch {
  const defaults: Partial<GenerationParams> = {};
  const size = normalizeSize(readString(source, "size"));
  const resolution = normalizeResolution(readString(source, "resolution"));
  const width = normalizeDimension(readUnknown(source, "width"));
  const height = normalizeDimension(readUnknown(source, "height"));
  const background = normalizeBackground(readString(source, "background"));
  const outputFormat = normalizeOutputFormat(readString(source, "outputFormat"));

  if (size) defaults.size = size;
  if (resolution) defaults.resolution = resolution;
  if (width !== undefined) defaults.width = width;
  if (height !== undefined) defaults.height = height;
  if (background) defaults.background = background;
  if (outputFormat) defaults.outputFormat = outputFormat;

  return Object.keys(defaults).length > 0 ? { defaults } : {};
}

function mergeSettingsPatches(
  currentSettings: AppSettings,
  ...patches: SettingsPatch[]
): SettingsPatch {
  return patches.reduce<SettingsPatch>((merged, patch) => ({
    ...merged,
    ...patch,
    defaults: patch.defaults
      ? {
          ...(merged.defaults ?? currentSettings.defaults),
          ...patch.defaults,
        }
      : merged.defaults,
  }), {});
}

function settingsPatchHasKeys(patch: SettingsPatch) {
  return Object.keys(patch).some((key) => {
    if (key !== "defaults") return true;
    return Boolean(patch.defaults && Object.keys(patch.defaults).length > 0);
  });
}

function parseSettingsPayload(value: string | null): SettingsPayload | null {
  if (!value) return null;

  try {
    const payload = JSON.parse(value);
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readUnknown(source: SettingsPayload | null | undefined, ...keys: string[]) {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.hasOwn(source, key)) return source[key];
  }
  return undefined;
}

function readString(source: SettingsPayload | null | undefined, ...keys: string[]) {
  const value = readUnknown(source, ...keys);
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is SettingsPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeApiBaseUrlMode(value: unknown): ApiBaseUrlMode | undefined {
  return value === "origin" || value === "full" ? value : undefined;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function normalizeSize(value: unknown): GenerationParams["size"] | undefined {
  return typeof value === "string" && SIZE_VALUES.includes(value as GenerationParams["size"])
    ? value as GenerationParams["size"]
    : undefined;
}

function normalizeResolution(value: unknown): SizeResolution | undefined {
  return typeof value === "string" && RESOLUTION_VALUES.includes(value as SizeResolution)
    ? value as SizeResolution
    : undefined;
}

function normalizeBackground(value: unknown): GenerationParams["background"] | undefined {
  return typeof value === "string" && BACKGROUND_VALUES.includes(value as GenerationParams["background"])
    ? value as GenerationParams["background"]
    : undefined;
}

function normalizeOutputFormat(value: unknown): GenerationParams["outputFormat"] | undefined {
  return typeof value === "string" && OUTPUT_FORMAT_VALUES.includes(value as GenerationParams["outputFormat"])
    ? value as GenerationParams["outputFormat"]
    : undefined;
}

function normalizeDimension(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return undefined;
  const dimension = Math.trunc(number);
  return dimension > 0 ? dimension : undefined;
}

function stripImagesApiPath(apiBaseUrl: string) {
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1\/images$/i, "");
}

export type { UrlSettingKey };
