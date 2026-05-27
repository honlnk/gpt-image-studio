import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  normalizePromptRewriteGuardText,
} from "./imagesApi";
import type {
  ApiBaseUrlMode,
  AppSettings,
  ConnectionMode,
  PromptMode,
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
  | "apiBaseUrlMode"
  | "promptMode"
  | "promptRewriteGuardEnabled"
  | "promptRewriteGuardText"
  | "promptRewriteGuardHistory"
> & {
  connectionMode?: ConnectionMode;
  apiBaseUrlMode?: ApiBaseUrlMode;
  promptRewriteGuardEnabled?: boolean;
  promptRewriteGuardText?: string;
  promptRewriteGuardHistory?: PromptRewriteGuardHistoryItem[];
  promptMode?: PromptMode;
  defaults: StoredGenerationParams;
};

function normalizeSettings(settings: StoredAppSettings): AppSettings {
  const promptRewriteGuardText = normalizePromptRewriteGuardText(
    settings.promptRewriteGuardText,
  );
  return {
    ...settings,
    connectionMode: settings.connectionMode ?? "direct",
    apiBaseUrlMode: settings.apiBaseUrlMode === "full" ? "full" : "origin",
    promptMode: normalizePromptMode(settings.promptMode),
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

function normalizePromptMode(mode: PromptMode | undefined): PromptMode {
  if (
    mode === "default" ||
    mode === "safe" ||
    mode === "creative" ||
    mode === "adult"
  ) {
    return mode;
  }

  return "default";
}
