import { computed, ref, watch } from "vue";
import { getCustomSizeError } from "../services/imagesApi";
import { saveSettings } from "../services/settings";
import type { AppSettings, GenerationParams } from "../types/studio";
import type { Ref } from "vue";

type UseStudioSettingsInput = {
  isHydrated: Ref<boolean>;
  onStorageError: (error: unknown) => void;
};

const SETTINGS_STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
} as const;

export function useStudioSettings(input: UseStudioSettingsInput) {
  const model = ref("gpt-image-2");
  const apiKey = ref(readStorage(SETTINGS_STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(readStorage(SETTINGS_STORAGE_KEYS.apiBaseUrl, ""));
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
  const activeSizePreset = ref<GenerationParams["size"]>("auto");
  const sizePresets = ["auto", "1024x1024", "1536x1024", "1024x1536", "custom"] as const;
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
  ] as const;
  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
    { value: "jpeg", label: "JPEG" },
  ] as const;
  const sizeLabel = computed(() => {
    if (activeSizePreset.value === "auto") return "自动";
    if (activeSizePreset.value === "custom") return `${imageWidth.value} x ${imageHeight.value}`;
    return activeSizePreset.value;
  });
  const customSizeError = computed(() => {
    if (activeSizePreset.value !== "custom") return "";

    return getCustomSizeError(imageWidth.value, imageHeight.value);
  });
  const qualityLabel = computed(
    () => qualityOptions.find((o) => o.value === quality.value)?.label ?? quality.value,
  );
  const backgroundLabel = computed(
    () => backgroundOptions.find((o) => o.value === background.value)?.label ?? background.value,
  );
  const formatLabel = computed(
    () => formatOptions.find((o) => o.value === outputFormat.value)?.label ?? outputFormat.value,
  );

  watch(
    [apiKey, apiBaseUrl, model, activeSizePreset, imageWidth, imageHeight, quality, background, outputFormat],
    () => {
      if (!input.isHydrated.value) return;
      void saveCurrentSettings().catch(input.onStorageError);
    },
  );

  function applySizePreset(preset: GenerationParams["size"]) {
    if (preset === "auto") {
      activeSizePreset.value = "auto";
    } else if (preset === "custom") {
      activeSizePreset.value = "custom";
    } else {
      activeSizePreset.value = preset;
      const [w, h] = preset.split("x").map(Number);
      imageWidth.value = w;
      imageHeight.value = h;
    }
  }

  function applySettings(settings: AppSettings) {
    apiKey.value = settings.apiKey;
    apiBaseUrl.value = settings.apiBaseUrl;
    model.value = settings.model;
    activeSizePreset.value = settings.defaults.size;
    imageWidth.value = settings.defaults.width;
    imageHeight.value = settings.defaults.height;
    quality.value = settings.defaults.quality;
    background.value = normalizeBackground(settings.defaults.background);
    outputFormat.value = settings.defaults.outputFormat;
  }

  function currentSettings(): AppSettings {
    return {
      apiKey: apiKey.value.trim(),
      apiBaseUrl: apiBaseUrl.value.trim(),
      model: model.value,
      defaults: currentGenerationParams(),
      storageMode: "indexeddb",
    };
  }

  function currentGenerationParams(): GenerationParams {
    return {
      size: activeSizePreset.value,
      width: imageWidth.value,
      height: imageHeight.value,
      quality: quality.value,
      background: background.value,
      outputFormat: outputFormat.value,
    };
  }

  function saveCurrentSettings() {
    return saveSettings(currentSettings());
  }

  return {
    activeSizePreset,
    apiBaseUrl,
    apiKey,
    applySettings,
    applySizePreset,
    background,
    backgroundLabel,
    backgroundOptions,
    currentGenerationParams,
    currentSettings,
    customSizeError,
    formatLabel,
    formatOptions,
    imageHeight,
    imageWidth,
    model,
    outputFormat,
    quality,
    qualityLabel,
    qualityOptions,
    saveCurrentSettings,
    sizeLabel,
    sizePresets,
  };
}

function normalizeBackground(background: GenerationParams["background"]) {
  if (background === "transparent") return "auto";

  return background;
}

function readStorage(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
