import {
  normalizeGenerationParams,
  type StoredGenerationParams,
} from "./generationParams";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  normalizePromptRewriteGuardText,
} from "./imagesApi";
import { normalizeFavoritePrompts } from "./favoritePrompts";
import { normalizePromptWordbanks } from "./promptWordbanks";
import { FIXED_IMAGE_MODEL } from "../shared/models";
import type {
  ApiMode,
  ApiBaseUrlMode,
  AnalyticsPromptCapture,
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
    value: {
      ...settings,
      model: FIXED_IMAGE_MODEL,
    },
  });
}

type StoredAppSettings = Omit<
  AppSettings,
  | "connectionMode"
  | "apiBaseUrlMode"
  | "apiMode"
  | "streamImages"
  | "streamPartialImages"
  | "promptMode"
  | "promptWordbanks"
  | "promptRewriteGuardEnabled"
  | "promptRewriteGuardText"
  | "promptRewriteGuardHistory"
  | "favoritePrompts"
  | "analyticsEnabled"
  | "analyticsPromptCapture"
> & {
  connectionMode?: ConnectionMode;
  apiBaseUrlMode?: ApiBaseUrlMode;
  apiMode?: ApiMode;
  streamImages?: boolean;
  streamPartialImages?: number;
  promptRewriteGuardEnabled?: boolean;
  promptRewriteGuardText?: string;
  promptRewriteGuardHistory?: PromptRewriteGuardHistoryItem[];
  favoritePrompts?: unknown;
  promptMode?: PromptMode;
  promptWordbanks?: unknown;
  analyticsEnabled?: boolean;
  analyticsPromptCapture?: AnalyticsPromptCapture;
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
    apiMode: settings.apiMode === "responses" ? "responses" : "images",
    streamImages: settings.streamImages ?? false,
    streamPartialImages: normalizeStreamPartialImages(
      settings.streamPartialImages,
    ),
    model: FIXED_IMAGE_MODEL,
    promptMode: normalizePromptMode(settings.promptMode),
    promptWordbanks: normalizePromptWordbanks(settings.promptWordbanks),
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
    favoritePrompts: normalizeFavoritePrompts(settings.favoritePrompts),
    defaults: normalizeGenerationParams(settings.defaults),
    analyticsEnabled: settings.analyticsEnabled ?? true,
    analyticsPromptCapture: normalizeAnalyticsPromptCapture(
      settings.analyticsPromptCapture,
    ),
  };
}

function normalizeAnalyticsPromptCapture(
  value: unknown,
): AnalyticsPromptCapture {
  if (
    value === "none" ||
    value === "length_only" ||
    value === "masked" ||
    value === "raw"
  ) {
    return value;
  }
  return "length_only";
}

function normalizeStreamPartialImages(value: unknown): 0 | 1 | 2 | 3 {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(3, Math.max(0, Math.trunc(numeric))) as 0 | 1 | 2 | 3;
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
