import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  normalizePromptRewriteGuardText,
} from "./imagesApi";
import type {
  AppSettings,
  ConnectionMode,
  PromptRewriteGuardHistoryItem,
} from "../types/studio";
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

type StoredAppSettings = Omit<
  AppSettings,
  | "connectionMode"
  | "promptRewriteGuardEnabled"
  | "promptRewriteGuardText"
  | "promptRewriteGuardHistory"
> & {
  connectionMode?: ConnectionMode;
  promptRewriteGuardEnabled?: boolean;
  promptRewriteGuardText?: string;
  promptRewriteGuardHistory?: PromptRewriteGuardHistoryItem[];
  defaults: StoredGenerationParams;
};

function normalizeSettings(settings: StoredAppSettings): AppSettings {
  const promptRewriteGuardText = normalizePromptRewriteGuardText(
    settings.promptRewriteGuardText,
  );
  return {
    ...settings,
    connectionMode: settings.connectionMode ?? "direct",
    promptRewriteGuardEnabled: settings.promptRewriteGuardEnabled ?? true,
    promptRewriteGuardText,
    promptRewriteGuardHistory:
      settings.promptRewriteGuardHistory ?? [
        {
          id: "prompt-guard-default",
          text: PROMPT_REWRITE_GUARD_PREFIX,
          createdAt: new Date(0).toISOString(),
        },
      ],
    defaults: normalizeGenerationParams(settings.defaults),
  };
}
