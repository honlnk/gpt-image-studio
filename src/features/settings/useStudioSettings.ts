import type { Ref } from "vue";
import { computed, ref, watch } from "vue";
import { getCustomSizeError } from "../../services/imagesApi";
import { saveSettings } from "../../services/settings";
import { readStorage } from "../../shared/localStorage";
import type {
  AppSettings,
  ConnectionMode,
  GenerationParams,
  SizeRatio,
  SizeResolution,
} from "../../types/studio";

type UseStudioSettingsInput = {
  isHydrated: Ref<boolean>;
  onStorageError: (error: unknown) => void;
};

const SETTINGS_STORAGE_KEYS = {
  apiKey: "gpt-image-studio:api-key",
  apiBaseUrl: "gpt-image-studio:api-base-url",
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
const LEGACY_SIZE_PRESETS = ["1024x1024", "1536x1024", "1024x1536"] as const;
const MAX_CUSTOM_DIMENSION = 3840;
const MAX_CUSTOM_PIXELS = 8294400;
const SIZE_STEP = 16;

export function useStudioSettings(input: UseStudioSettingsInput) {
  const connectionMode = ref<ConnectionMode>("direct");
  const model = ref("gpt-image-2");
  const apiKey = ref(readStorage(SETTINGS_STORAGE_KEYS.apiKey, ""));
  const apiBaseUrl = ref(readStorage(SETTINGS_STORAGE_KEYS.apiBaseUrl, ""));
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
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
  const formatLabel = computed(
    () =>
      formatOptions.find((o) => o.value === outputFormat.value)?.label ??
      outputFormat.value,
  );

  watch(
    [
      connectionMode,
      apiKey,
      apiBaseUrl,
      model,
      activeSizePreset,
      sizeResolution,
      imageWidth,
      imageHeight,
      quality,
      background,
      outputFormat,
    ],
    () => {
      if (!input.isHydrated.value) return;
      void saveCurrentSettings().catch(input.onStorageError);
    },
  );

  function applyRatioDimensions(ratio: SizeRatio, resolution: SizeResolution) {
    const dimensions = dimensionsForRatio(ratio, resolution);
    imageWidth.value = dimensions.width;
    imageHeight.value = dimensions.height;
  }

  function applySizePreset(preset: GenerationParams["size"]) {
    const normalizedPreset = normalizeSizePreset(preset);
    if (preset === "auto") {
      activeSizePreset.value = "auto";
    } else if (preset === "custom") {
      activeSizePreset.value = "custom";
    } else if (normalizedPreset) {
      activeSizePreset.value = normalizedPreset;
      applyRatioDimensions(normalizedPreset, sizeResolution.value);
    } else {
      activeSizePreset.value = preset;
      const [w, h] = preset.split("x").map(Number);
      imageWidth.value = w;
      imageHeight.value = h;
    }
  }

  function applySizeResolution(resolution: SizeResolution) {
    sizeResolution.value = resolution;
    const ratio = normalizeSizePreset(activeSizePreset.value);
    if (!ratio) return;
    applyRatioDimensions(ratio, resolution);
  }

  function applySettings(settings: AppSettings) {
    connectionMode.value = settings.connectionMode;
    apiKey.value = settings.apiKey;
    apiBaseUrl.value = settings.apiBaseUrl;
    model.value = settings.model;
    sizeResolution.value =
      settings.defaults.resolution ?? inferSizeResolution(settings.defaults);
    applySizePreset(settings.defaults.size);
    if (
      settings.defaults.size === "custom" ||
      isLegacySizePreset(settings.defaults.size)
    ) {
      imageWidth.value = settings.defaults.width;
      imageHeight.value = settings.defaults.height;
    }
    quality.value = settings.defaults.quality;
    background.value = normalizeBackground(settings.defaults.background);
    outputFormat.value = settings.defaults.outputFormat;
  }

  function currentSettings(): AppSettings {
    return {
      connectionMode: connectionMode.value,
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
      resolution: sizeResolution.value,
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
    connectionMode,
    applySettings,
    applySizePreset,
    applySizeResolution,
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
    sizeRatioOptions,
    sizeResolution,
    sizeResolutionOptions,
  };
}

function normalizeBackground(background: GenerationParams["background"]) {
  if (background === "transparent") return "auto";

  return background;
}

function normalizeSizePreset(size: GenerationParams["size"]): SizeRatio | null {
  if (isSizeRatio(size)) return size;
  if (size === "1024x1024") return "1:1";
  if (size === "1536x1024") return "3:2";
  if (size === "1024x1536") return "2:3";
  return null;
}

function isSizeRatio(size: GenerationParams["size"]): size is SizeRatio {
  return SIZE_RATIO_OPTIONS.some((option) => option.value === size);
}

function isLegacySizePreset(size: GenerationParams["size"]) {
  return LEGACY_SIZE_PRESETS.some((preset) => preset === size);
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

function inferSizeResolution(params: GenerationParams): SizeResolution {
  const pixels = params.width * params.height;
  if (pixels > 2048 * 2048) return "4k";
  if (pixels > 1024 * 1024) return "2k";
  return "1k";
}
