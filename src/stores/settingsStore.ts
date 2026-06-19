import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  isSizeRatio,
  MIN_IMAGE_COUNT,
  normalizeGenerationParams,
  normalizeImageCount,
  normalizeSizePreset,
  type StoredGenerationParams,
} from "../services/generationParams";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  getCustomSizeError,
  normalizePromptRewriteGuardText,
} from "../services/imagesApi";
import {
  createFavoritePrompt,
  normalizeFavoritePromptUpdate,
  normalizeFavoritePrompts,
} from "../services/favoritePrompts";
import {
  clonePromptWordbanks,
  defaultPromptWordbanks,
  normalizePromptWordbanks,
  normalizeWordbankTerms,
} from "../services/promptWordbanks";
import { saveSettings } from "../services/settings";
import { isoTimestamp } from "../shared/dateTime";
import { createId } from "../shared/id";
import { readStorage, writeStorage } from "../shared/localStorage";
import { FIXED_IMAGE_MODEL } from "../shared/models";
import type {
  AnalyticsPromptCapture,
  ApiMode,
  AppSettings,
  ConnectionMode,
  FavoritePrompt,
  GenerationParams,
  PromptMode,
  PromptRewriteGuardHistoryItem,
  PromptWordbankSectionKey,
  PromptWordbanks,
  SizeRatio,
  SizeResolution,
} from "../types/studio";

const SETTINGS_STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
  companionUrl: "gpt-image-studio:companion-url",
  companionSessionToken: "gpt-image-studio:companion-session-token",
} as const;

const SIZE_RATIO_OPTIONS = [
  { value: "21:9", label: "21:9", widthRatio: 21, heightRatio: 9 },
  { value: "16:9", label: "16:9", widthRatio: 16, heightRatio: 9 },
  { value: "3:2", label: "3:2", widthRatio: 3, heightRatio: 2 },
  { value: "4:3", label: "4:3", widthRatio: 4, heightRatio: 3 },
  { value: "1:1", label: "1:1", widthRatio: 1, heightRatio: 1 },
  { value: "9:16", label: "9:16", widthRatio: 9, heightRatio: 16 },
  { value: "2:3", label: "2:3", widthRatio: 2, heightRatio: 3 },
  { value: "3:4", label: "3:4", widthRatio: 3, heightRatio: 4 },
] as const;
const SIZE_RESOLUTION_OPTIONS = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
  { value: "4k", label: "4K", targetPixels: 3840 * 2160 },
] as const;
const MAX_CUSTOM_DIMENSION = 3840;
const MAX_CUSTOM_PIXELS = 8294400;
const SIZE_STEP = 16;
const MAX_PROMPT_REWRITE_GUARD_HISTORY = 20;
const IMAGE_COUNT_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
type ImageCountMode = "preset" | "custom";

export const useSettingsStore = defineStore("settings", () => {
  const connectionMode = ref<ConnectionMode>("direct");
  const apiMode = ref<ApiMode>("images");
  const model = ref(FIXED_IMAGE_MODEL);
  const apiKey = ref(readStorage(SETTINGS_STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(readStorage(SETTINGS_STORAGE_KEYS.apiBaseUrl, ""));
  const apiBaseUrlMode = ref<AppSettings["apiBaseUrlMode"]>("origin");
  const streamImages = ref(false);
  const streamPartialImages = ref<0 | 1 | 2 | 3>(1);
  const promptMode = ref<PromptMode>("default");
  const promptWordbanks = ref<PromptWordbanks>(
    clonePromptWordbanks(defaultPromptWordbanks),
  );
  const promptRewriteGuardEnabled = ref(true);
  const promptRewriteGuardText = ref(PROMPT_REWRITE_GUARD_PREFIX);
  const autoRetryOnNetworkError = ref(false);
  const analyticsEnabled = ref(true);
  const analyticsPromptCapture = ref<AnalyticsPromptCapture>("length_only");
  const favoritePrompts = ref<FavoritePrompt[]>([]);
  const promptRewriteGuardHistory = ref<PromptRewriteGuardHistoryItem[]>([
    {
      id: "prompt-guard-default",
      text: PROMPT_REWRITE_GUARD_PREFIX,
      createdAt: isoTimestamp(0),
    },
  ]);
  const companionUrl = ref(
    readStorage(SETTINGS_STORAGE_KEYS.companionUrl, "http://127.0.0.1:19750"),
  );
  const companionSessionToken = ref(
    readStorage(SETTINGS_STORAGE_KEYS.companionSessionToken, ""),
  );
  const companionPaired = computed(() => companionSessionToken.value !== "");
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
  const imageCount = ref(1);
  const imageCountMode = ref<ImageCountMode>("preset");
  const imageCountPresets = IMAGE_COUNT_PRESETS;
  const activeSizePreset = ref<GenerationParams["size"]>("auto");
  const sizeResolution = ref<SizeResolution>("1k");
  const sizeRatioOptions = SIZE_RATIO_OPTIONS;
  const sizeResolutionOptions = SIZE_RESOLUTION_OPTIONS.map(
    ({ value, label }) => ({ value, label }),
  );
  const quality = ref<GenerationParams["quality"]>("auto");
  const background = ref<GenerationParams["background"]>("auto");
  const outputFormat = ref<GenerationParams["outputFormat"]>("png");
  const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
  ] as const;
  const backgroundOptions = [
    { value: "auto", label: "自动" },
    { value: "opaque", label: "不透明" },
    { value: "transparent", label: "透明" },
  ] as const;
  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
    { value: "jpeg", label: "JPEG" },
  ] as const;
  const sizeLabel = computed(() => {
    if (activeSizePreset.value === "auto") return "自动";
    if (activeSizePreset.value === "custom")
      return `${imageWidth.value} x ${imageHeight.value}`;
    return `${imageWidth.value} x ${imageHeight.value}`;
  });
  const customSizeError = computed(() => {
    if (activeSizePreset.value !== "custom") return "";

    return getCustomSizeError(imageWidth.value, imageHeight.value);
  });
  const qualityLabel = computed(
    () =>
      qualityOptions.find((o) => o.value === quality.value)?.label ??
      quality.value,
  );
  const backgroundLabel = computed(
    () =>
      backgroundOptions.find((o) => o.value === background.value)?.label ??
      background.value,
  );
  const transparentDisabled = computed(() => model.value === FIXED_IMAGE_MODEL);
  const formatLabel = computed(
    () =>
      formatOptions.find((o) => o.value === outputFormat.value)?.label ??
      outputFormat.value,
  );

  function applyRatioDimensions(ratio: SizeRatio, resolution: SizeResolution) {
    const dimensions = dimensionsForRatio(ratio, resolution);
    imageWidth.value = dimensions.width;
    imageHeight.value = dimensions.height;
  }

  function applySizePreset(preset: StoredGenerationParams["size"]) {
    const normalizedPreset = normalizeSizePreset(preset);
    if (preset === "auto") {
      activeSizePreset.value = "auto";
    } else if (preset === "custom") {
      activeSizePreset.value = "custom";
    } else if (isSizeRatio(normalizedPreset)) {
      activeSizePreset.value = normalizedPreset;
      applyRatioDimensions(normalizedPreset, sizeResolution.value);
    }
  }

  function applySizeResolution(resolution: SizeResolution) {
    sizeResolution.value = resolution;
    const ratio = normalizeSizePreset(activeSizePreset.value);
    if (!isSizeRatio(ratio)) return;
    applyRatioDimensions(ratio, resolution);
  }

  function applySettings(settings: AppSettings) {
    const defaults = normalizeGenerationParams(settings.defaults);
    connectionMode.value = settings.connectionMode;
    apiKey.value = settings.apiKey;
    apiBaseUrlMode.value = settings.apiBaseUrlMode;
    apiBaseUrl.value = displayApiBaseUrl(settings.apiBaseUrl, settings.apiBaseUrlMode);
    apiMode.value = settings.apiMode;
    streamImages.value = settings.streamImages;
    streamPartialImages.value = settings.streamPartialImages;
    model.value = FIXED_IMAGE_MODEL;
    promptMode.value = settings.promptMode;
    promptWordbanks.value = normalizePromptWordbanks(settings.promptWordbanks);
    promptRewriteGuardEnabled.value = settings.promptRewriteGuardEnabled;
    promptRewriteGuardText.value = normalizePromptRewriteGuardText(
      settings.promptRewriteGuardText,
    );
    autoRetryOnNetworkError.value = settings.autoRetryOnNetworkError ?? false;
    analyticsEnabled.value = settings.analyticsEnabled ?? true;
    analyticsPromptCapture.value =
      settings.analyticsPromptCapture ?? "length_only";
    promptRewriteGuardHistory.value = normalizePromptRewriteGuardHistory(
      settings.promptRewriteGuardHistory,
      promptRewriteGuardText.value,
    );
    favoritePrompts.value = normalizeFavoritePrompts(settings.favoritePrompts);
    sizeResolution.value = defaults.resolution;
    applySizePreset(defaults.size);
    if (defaults.size === "custom" || isSizeRatio(defaults.size)) {
      imageWidth.value = defaults.width;
      imageHeight.value = defaults.height;
    }
    imageCount.value = normalizeImageCount(defaults.imageCount);
    imageCountMode.value = imageCountPresets.includes(
      imageCount.value as (typeof IMAGE_COUNT_PRESETS)[number],
    )
      ? "preset"
      : "custom";
    quality.value = defaults.quality;
    background.value = normalizeBackground(defaults.background);
    outputFormat.value = defaults.outputFormat;
  }

  function currentSettings(): AppSettings {
    return {
      connectionMode: connectionMode.value,
      apiKey: apiKey.value.trim(),
      apiBaseUrl: apiBaseUrl.value.trim(),
      apiBaseUrlMode: apiBaseUrlMode.value,
      apiMode: apiMode.value,
      streamImages: streamImages.value,
      streamPartialImages: streamPartialImages.value,
      model: FIXED_IMAGE_MODEL,
      promptMode: promptMode.value,
      promptWordbanks: clonePromptWordbanks(promptWordbanks.value),
      promptRewriteGuardEnabled: promptRewriteGuardEnabled.value,
      promptRewriteGuardText: promptRewriteGuardText.value,
      promptRewriteGuardHistory: promptRewriteGuardHistory.value.map(
        toPlainPromptRewriteGuardHistoryItem,
      ),
      favoritePrompts: favoritePrompts.value.map(toPlainFavoritePrompt),
      autoRetryOnNetworkError: autoRetryOnNetworkError.value,
      analyticsEnabled: analyticsEnabled.value,
      analyticsPromptCapture: analyticsPromptCapture.value,
      defaults: currentGenerationParams(),
      storageMode: "indexeddb",
    };
  }

  function currentGenerationParams(): GenerationParams {
    return {
      size: activeSizePreset.value,
      resolution: sizeResolution.value,
      width: imageWidth.value,
      height: imageHeight.value,
      imageCount: normalizeImageCount(imageCount.value),
      quality: quality.value,
      background: background.value,
      outputFormat: outputFormat.value,
    };
  }

  function applyImageCountMode(mode: ImageCountMode) {
    imageCountMode.value = mode;
    if (
      mode === "preset" &&
      !imageCountPresets.includes(
        imageCount.value as (typeof IMAGE_COUNT_PRESETS)[number],
      )
    ) {
      imageCount.value = imageCountPresets[0];
    }
  }

  function applyImageCount(count: unknown, mode = imageCountMode.value) {
    imageCount.value = normalizeImageCount(count);
    imageCountMode.value = mode;
  }

  function saveCurrentSettings() {
    return saveSettings(currentSettings());
  }

  function savePromptRewriteGuardText(text: string) {
    const normalizedText = normalizePromptRewriteGuardText(text);
    promptRewriteGuardText.value = normalizedText;
    promptRewriteGuardHistory.value = addPromptGuardHistoryItem(
      promptRewriteGuardHistory.value,
      normalizedText,
    );
  }

  function savePromptWordbank(section: PromptWordbankSectionKey, terms: string[]) {
    const normalizedTerms = normalizeWordbankTerms(terms);
    promptWordbanks.value = setPromptWordbankTerms(
      promptWordbanks.value,
      section,
      normalizedTerms,
    );
  }

  function restoreDefaultPromptWordbank(section: PromptWordbankSectionKey) {
    promptWordbanks.value = setPromptWordbankTerms(
      promptWordbanks.value,
      section,
      getPromptWordbankTerms(defaultPromptWordbanks, section),
    );
  }

  function restoreDefaultPromptRewriteGuardText() {
    savePromptRewriteGuardText(PROMPT_REWRITE_GUARD_PREFIX);
  }

  function addFavoritePrompt(input: { title?: string; text?: string }) {
    const prompt = createFavoritePrompt(input);
    if (!prompt.text) return false;
    favoritePrompts.value = [prompt, ...favoritePrompts.value];
    return true;
  }

  function updateFavoritePrompt(
    id: string,
    input: { title?: string; text?: string },
  ) {
    const update = normalizeFavoritePromptUpdate(input);
    if (!update.text) return false;

    let didUpdate = false;
    favoritePrompts.value = favoritePrompts.value.map((item) => {
      if (item.id !== id) return item;
      didUpdate = true;
      return {
        ...item,
        ...update,
        updatedAt: isoTimestamp(),
      };
    });
    return didUpdate;
  }

  function deleteFavoritePrompt(id: string) {
    favoritePrompts.value = favoritePrompts.value.filter(
      (item) => item.id !== id,
    );
  }

  function restorePromptRewriteGuardHistoryItem(id: string) {
    const item = promptRewriteGuardHistory.value.find(
      (entry) => entry.id === id,
    );
    if (!item) return false;
    promptRewriteGuardText.value = normalizePromptRewriteGuardText(item.text);
    return true;
  }

  function deletePromptRewriteGuardHistoryItem(id: string) {
    promptRewriteGuardHistory.value = promptRewriteGuardHistory.value.filter(
      (item) => item.id !== id,
    );
  }

  watch(companionUrl, (v) =>
    writeStorage(SETTINGS_STORAGE_KEYS.companionUrl, v),
  );
  watch(companionSessionToken, (v) =>
    writeStorage(SETTINGS_STORAGE_KEYS.companionSessionToken, v),
  );

  return {
    activeSizePreset,
    apiMode,
    apiBaseUrl,
    apiBaseUrlMode,
    apiKey,
    autoRetryOnNetworkError,
    analyticsEnabled,
    analyticsPromptCapture,
    companionPaired,
    companionSessionToken,
    companionUrl,
    connectionMode,
    applySettings,
    applyImageCount,
    applyImageCountMode,
    applySizePreset,
    applySizeResolution,
    background,
    backgroundLabel,
    backgroundOptions,
    transparentDisabled,
    currentGenerationParams,
    currentSettings,
    customSizeError,
    formatLabel,
    formatOptions,
    favoritePrompts,
    imageCount,
    imageCountMode,
    imageCountPresets,
    minImageCount: MIN_IMAGE_COUNT,
    imageHeight,
    imageWidth,
    model,
    outputFormat,
    streamImages,
    streamPartialImages,
    promptMode,
    promptWordbanks,
    promptRewriteGuardEnabled,
    promptRewriteGuardHistory,
    promptRewriteGuardText,
    quality,
    qualityLabel,
    qualityOptions,
    saveCurrentSettings,
    sizeLabel,
    sizeRatioOptions,
    sizeResolution,
    sizeResolutionOptions,
    deletePromptRewriteGuardHistoryItem,
    restoreDefaultPromptRewriteGuardText,
    restoreDefaultPromptWordbank,
    restorePromptRewriteGuardHistoryItem,
    savePromptRewriteGuardText,
    savePromptWordbank,
    addFavoritePrompt,
    updateFavoritePrompt,
    deleteFavoritePrompt,
  };
});

function getPromptWordbankTerms(
  wordbanks: PromptWordbanks,
  section: PromptWordbankSectionKey,
) {
  if (section === "pose.safe") return wordbanks.pose.safe;
  if (section === "pose.creative") return wordbanks.pose.creative;
  if (section === "pose.nsfw") return wordbanks.pose.nsfw;
  return wordbanks.adultInspiration;
}

function setPromptWordbankTerms(
  wordbanks: PromptWordbanks,
  section: PromptWordbankSectionKey,
  terms: string[],
) {
  const next = clonePromptWordbanks(wordbanks);
  if (section === "pose.safe") next.pose.safe = [...terms];
  if (section === "pose.creative") next.pose.creative = [...terms];
  if (section === "pose.nsfw") next.pose.nsfw = [...terms];
  if (section === "adultInspiration") next.adultInspiration = [...terms];
  return next;
}

function normalizePromptRewriteGuardHistory(
  history: PromptRewriteGuardHistoryItem[] | undefined,
  currentText: string,
) {
  const seen = new Set<string>();
  const normalizedItems = (Array.isArray(history) ? history : [])
    .map((item) => ({
      id: item.id || createId("prompt-guard"),
      text: normalizePromptRewriteGuardText(item.text),
      createdAt: item.createdAt || isoTimestamp(),
    }))
    .filter((item) => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });

  if (!seen.has(currentText)) {
    normalizedItems.unshift({
      id: createId("prompt-guard"),
      text: currentText,
      createdAt: isoTimestamp(),
    });
  }

  return normalizedItems.slice(0, MAX_PROMPT_REWRITE_GUARD_HISTORY);
}

function addPromptGuardHistoryItem(
  history: PromptRewriteGuardHistoryItem[],
  text: string,
) {
  if (history[0]?.text === text) return history;

  return [
    {
      id: createId("prompt-guard"),
      text,
      createdAt: isoTimestamp(),
    },
    ...history.filter((item) => item.text !== text),
  ].slice(0, MAX_PROMPT_REWRITE_GUARD_HISTORY);
}

function toPlainPromptRewriteGuardHistoryItem(
  item: PromptRewriteGuardHistoryItem,
): PromptRewriteGuardHistoryItem {
  return {
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
  };
}

function toPlainFavoritePrompt(item: FavoritePrompt): FavoritePrompt {
  return {
    id: item.id,
    title: item.title,
    text: item.text,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeBackground(background: GenerationParams["background"]) {
  if (background === "transparent") return "auto";

  return background;
}

function displayApiBaseUrl(apiBaseUrl: string, mode: AppSettings["apiBaseUrlMode"]) {
  if (mode === "full") return apiBaseUrl;
  return stripImagesApiPath(apiBaseUrl);
}

function stripImagesApiPath(apiBaseUrl: string) {
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1\/images$/i, "");
}

function dimensionsForRatio(ratio: SizeRatio, resolution: SizeResolution) {
  const ratioOption =
    SIZE_RATIO_OPTIONS.find((option) => option.value === ratio) ??
    SIZE_RATIO_OPTIONS[4];
  const resolutionOption =
    SIZE_RESOLUTION_OPTIONS.find((option) => option.value === resolution) ??
    SIZE_RESOLUTION_OPTIONS[0];
  const aspect = ratioOption.widthRatio / ratioOption.heightRatio;
  let width = Math.sqrt(resolutionOption.targetPixels * aspect);
  let height = width / aspect;
  const maxSide = Math.max(width, height);

  if (maxSide > MAX_CUSTOM_DIMENSION) {
    const scale = MAX_CUSTOM_DIMENSION / maxSide;
    width *= scale;
    height *= scale;
  }

  let normalizedWidth = roundToStep(width);
  let normalizedHeight = roundToStep(height);

  while (normalizedWidth * normalizedHeight > MAX_CUSTOM_PIXELS) {
    if (normalizedWidth >= normalizedHeight) {
      normalizedWidth -= SIZE_STEP;
      normalizedHeight = roundToStep(normalizedWidth / aspect);
    } else {
      normalizedHeight -= SIZE_STEP;
      normalizedWidth = roundToStep(normalizedHeight * aspect);
    }
  }

  return {
    width: clampDimension(normalizedWidth),
    height: clampDimension(normalizedHeight),
  };
}

function roundToStep(value: number) {
  return clampDimension(Math.round(value / SIZE_STEP) * SIZE_STEP);
}

function clampDimension(value: number) {
  return Math.min(MAX_CUSTOM_DIMENSION, Math.max(SIZE_STEP, value));
}
