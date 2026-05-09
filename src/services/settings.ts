import type { AppSettings, ConnectionMode, GenerationParams } from "../types/studio";
import { getFromStore, putInStore, STORE_NAMES } from "./db";

const SETTINGS_KEY = "app";

type SettingsRecord = {
  key: typeof SETTINGS_KEY;
  value: StoredAppSettings;
};

export async function loadSettings() {
  const record = await getFromStore<SettingsRecord>(
    STORE_NAMES.settings,
    SETTINGS_KEY,
  );

  if (!record?.value) return undefined;

  return normalizeSettings(record.value);
}

export function saveSettings(settings: AppSettings) {
  return putInStore<SettingsRecord>(STORE_NAMES.settings, {
    key: SETTINGS_KEY,
    value: settings,
  });
}

type StoredAppSettings = Omit<AppSettings, "connectionMode"> & {
  connectionMode?: ConnectionMode;
  defaults: GenerationParams;
};

function normalizeSettings(settings: StoredAppSettings): AppSettings {
  return {
    ...settings,
    connectionMode: settings.connectionMode ?? "direct",
  };
}
