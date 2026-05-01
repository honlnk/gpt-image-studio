import type { AppSettings } from "../types/studio";
import { getFromStore, putInStore, STORE_NAMES } from "./db";

const SETTINGS_KEY = "app";

type SettingsRecord = {
  key: typeof SETTINGS_KEY;
  value: AppSettings;
};

export async function loadSettings() {
  const record = await getFromStore<SettingsRecord>(
    STORE_NAMES.settings,
    SETTINGS_KEY,
  );

  return record?.value;
}

export function saveSettings(settings: AppSettings) {
  return putInStore<SettingsRecord>(STORE_NAMES.settings, {
    key: SETTINGS_KEY,
    value: settings,
  });
}
