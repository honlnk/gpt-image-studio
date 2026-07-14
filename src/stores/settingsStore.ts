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
  type SizeConstraints,
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
  CompanionAuthStatus,
  CompanionProviderCapability,
} from "../types/companion";
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
  companionAccessKey: "gpt-image-studio:companion-access-key",
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

/**
 * direct 模式 / companion 离线时的兜底默认档位（OpenAI 形状 1K/2K/4K）。
 * 走 companion 的 provider 一律用 companion 回流的 resolutionOptions，不读这个。
 */
const DEFAULT_RESOLUTION_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  targetPixels: number;
}> = SIZE_RESOLUTION_OPTIONS;

// OpenAI/gpt-image-2 的默认尺寸约束。companion 在线时被 providerCapability/sizeConstraints
// 覆盖；离线或未回流时回退到这些值，保持现状行为。
const DEFAULT_SIZE_STEP = 16;
const DEFAULT_MIN_CUSTOM_DIMENSION = 16;
const DEFAULT_MAX_CUSTOM_DIMENSION = 3840;
const DEFAULT_MAX_CUSTOM_PIXELS = 8294400;
const DEFAULT_MIN_CUSTOM_PIXELS = 655360;
const DEFAULT_MAX_ASPECT_RATIO = 3;
// OpenAI（gpt-image-2）全能力默认值——companion 未回流时的 UI 行为。
// backgrounds 不含 transparent，与 gpt-image-2 现状一致。
const DEFAULT_PROVIDER_CAPABILITY: CompanionProviderCapability = {
  generate: true,
  edit: true,
  mask: true,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "webp", "jpeg"],
};
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
  const companionAccessKey = ref(
    readStorage(SETTINGS_STORAGE_KEYS.companionAccessKey, ""),
  );
  const companionConnected = computed(() => companionAccessKey.value !== "");
  const imageWidth = ref(1024);
  const imageHeight = ref(1024);
  const imageCount = ref(1);
  const imageCountMode = ref<ImageCountMode>("preset");
  const imageCountPresets = IMAGE_COUNT_PRESETS;
  const activeSizePreset = ref<GenerationParams["size"]>("auto");
  const sizeResolution = ref<SizeResolution>("1k");
  const sizeRatioOptions = SIZE_RATIO_OPTIONS;
  // 分辨率档位：companion 声明、web 渲染（D1）。
  // 走 companion 的 provider 一律用 companion 回流的档位（如豆包 [2k,3k,4k]）；
  // direct / 离线 / 未回流时用 OpenAI 兜底默认 [1k,2k,4k]。
  // 不再用 maxPixels 运行时过滤——provider 声明什么是它自己的真实能力。
  const resolutionOptions = ref(DEFAULT_RESOLUTION_OPTIONS.map((o) => ({ ...o })));
  const sizeResolutionOptions = computed(() =>
    resolutionOptions.value.map(({ value, label }) => ({ value, label })),
  );
  const quality = ref<GenerationParams["quality"]>("auto");
  const background = ref<GenerationParams["background"]>("auto");
  const outputFormat = ref<GenerationParams["outputFormat"]>("png");
  // provider 元信息（companion /auth/status 回流）。未回流时用 OpenAI 默认值，
  // 保证离线/未配对时 UI 行为与现状一致。
  const providerCapability = ref<CompanionProviderCapability>({
    ...DEFAULT_PROVIDER_CAPABILITY,
    backgrounds: [...DEFAULT_PROVIDER_CAPABILITY.backgrounds],
    outputFormats: [...DEFAULT_PROVIDER_CAPABILITY.outputFormats],
  });
  // 尺寸软约束（companion 回流，未回流时 OpenAI 默认）。
  const sizeStep = ref(DEFAULT_SIZE_STEP);
  const minCustomDimension = ref(DEFAULT_MIN_CUSTOM_DIMENSION);
  const maxCustomDimension = ref(DEFAULT_MAX_CUSTOM_DIMENSION);
  const maxCustomPixels = ref(DEFAULT_MAX_CUSTOM_PIXELS);
  const minCustomPixels = ref(DEFAULT_MIN_CUSTOM_PIXELS);
  const maxAspectRatio = ref<number | null>(DEFAULT_MAX_ASPECT_RATIO);
  const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
  ] as const;
  // 全量选项（capability 过滤的数据源）
  const allBackgroundOptions = [
    { value: "auto", label: "自动" },
    { value: "opaque", label: "不透明" },
    { value: "transparent", label: "透明" },
  ] as const;
  const allFormatOptions = [
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
    { value: "jpeg", label: "JPEG" },
  ] as const;
  // 按 capability 过滤后的可见选项。provider 不支持的值不会出现。
  const backgroundOptions = computed(() =>
    allBackgroundOptions.filter((o) =>
      providerCapability.value.backgrounds.includes(o.value),
    ),
  );
  const formatOptions = computed(() =>
    allFormatOptions.filter((o) =>
      providerCapability.value.outputFormats.includes(o.value),
    ),
  );
  const backgroundTagVisible = computed(() => backgroundOptions.value.length > 1);
  const formatTagVisible = computed(() => formatOptions.value.length > 1);
  const sizeLabel = computed(() => {
    if (activeSizePreset.value === "auto") return "自动";
    if (activeSizePreset.value === "custom")
      return `${imageWidth.value} x ${imageHeight.value}`;
    return `${imageWidth.value} x ${imageHeight.value}`;
  });
  // 聚合当前生效的尺寸约束（供 customSizeError 校验 + imagesApi 请求路径校验共用）。
  const currentSizeConstraints = computed<SizeConstraints>(() => ({
    step: sizeStep.value,
    min: minCustomDimension.value,
    max: maxCustomDimension.value,
    maxPixels: maxCustomPixels.value,
    minPixels: minCustomPixels.value,
    maxAspectRatio: maxAspectRatio.value,
    defaultSize: "1024x1024",
  }));
  const customSizeError = computed(() => {
    if (activeSizePreset.value !== "custom") return "";

    return getCustomSizeError(
      imageWidth.value,
      imageHeight.value,
      currentSizeConstraints.value,
    );
  });
  const qualityLabel = computed(
    () =>
      qualityOptions.find((o) => o.value === quality.value)?.label ??
      quality.value,
  );
  const backgroundLabel = computed(
    () =>
      backgroundOptions.value.find((o) => o.value === background.value)?.label ??
      background.value,
  );
  // transparent 是否被禁用：以 capability 为准（provider 不支持 transparent 时禁用）。
  // 兜底逻辑：UI 已通过 backgroundOptions 过滤掉不支持的值，这里保留作为双保险。
  const transparentDisabled = computed(
    () => !providerCapability.value.backgrounds.includes("transparent"),
  );
  const formatLabel = computed(
    () =>
      formatOptions.value.find((o) => o.value === outputFormat.value)?.label ??
      outputFormat.value,
  );

  // 尺寸计算（读 sizeConstraints ref + resolutionOptions ref，受 companion 回流驱动）
  function dimensionsForRatio(ratio: SizeRatio, resolution: SizeResolution) {
    const ratioOption =
      SIZE_RATIO_OPTIONS.find((option) => option.value === ratio) ??
      SIZE_RATIO_OPTIONS[4];
    // 读 companion 回流的 resolutionOptions（如豆包 [2k,3k,4k]），找不到时回退第一个。
    const resolutionOption =
      resolutionOptions.value.find((option) => option.value === resolution) ??
      resolutionOptions.value[0];
    const aspect = ratioOption.widthRatio / ratioOption.heightRatio;
    let width = Math.sqrt(resolutionOption.targetPixels * aspect);
    let height = width / aspect;
    const maxSide = Math.max(width, height);

    if (maxSide > maxCustomDimension.value) {
      const scale = maxCustomDimension.value / maxSide;
      width *= scale;
      height *= scale;
    }

    let normalizedWidth = roundToStep(width);
    let normalizedHeight = roundToStep(height);

    while (normalizedWidth * normalizedHeight > maxCustomPixels.value) {
      if (normalizedWidth >= normalizedHeight) {
        normalizedWidth -= sizeStep.value;
        normalizedHeight = roundToStep(normalizedWidth / aspect);
      } else {
        normalizedHeight -= sizeStep.value;
        normalizedWidth = roundToStep(normalizedHeight * aspect);
      }
    }

    return {
      width: clampDimension(normalizedWidth),
      height: clampDimension(normalizedHeight),
    };
  }

  function roundToStep(value: number) {
    return clampDimension(Math.round(value / sizeStep.value) * sizeStep.value);
  }

  function clampDimension(value: number) {
    return Math.min(
      maxCustomDimension.value,
      Math.max(sizeStep.value, value),
    );
  }

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

  /**
   * 写入 companion /auth/status 回流的 provider 元信息。
   * status 为 null（离线/未配对/失配）时重置为 OpenAI 默认 capability + 约束，
   * 保证 UI 行为回到 gpt-image-2 默认。
   */
  function applyProviderInfo(status: CompanionAuthStatus | null) {
    if (!status || !status.ready) {
      providerCapability.value = {
        ...DEFAULT_PROVIDER_CAPABILITY,
        backgrounds: [...DEFAULT_PROVIDER_CAPABILITY.backgrounds],
        outputFormats: [...DEFAULT_PROVIDER_CAPABILITY.outputFormats],
      };
      sizeStep.value = DEFAULT_SIZE_STEP;
      minCustomDimension.value = DEFAULT_MIN_CUSTOM_DIMENSION;
      maxCustomDimension.value = DEFAULT_MAX_CUSTOM_DIMENSION;
      maxCustomPixels.value = DEFAULT_MAX_CUSTOM_PIXELS;
      minCustomPixels.value = DEFAULT_MIN_CUSTOM_PIXELS;
      maxAspectRatio.value = DEFAULT_MAX_ASPECT_RATIO;
      resolutionOptions.value = DEFAULT_RESOLUTION_OPTIONS.map((o) => ({ ...o }));
      // 离线时若当前选中档不在默认列表（如刚从豆包切回 direct，还停在 3k），回退第一个。
      const defaultValues = DEFAULT_RESOLUTION_OPTIONS.map((o) => o.value);
      if (!defaultValues.includes(sizeResolution.value)) {
        sizeResolution.value = defaultValues[0] ?? "1k";
      }
      const ratio = normalizeSizePreset(activeSizePreset.value);
      if (isSizeRatio(ratio)) applyRatioDimensions(ratio, sizeResolution.value);
      // 离线时 model 不回退——保留用户上次生效的 model，避免 UI 闪烁
      return;
    }

    providerCapability.value = {
      ...status.capability,
      backgrounds: [...status.capability.backgrounds],
      outputFormats: [...status.capability.outputFormats],
    };
    const sc = status.sizeConstraints;
    sizeStep.value = sc.step;
    minCustomDimension.value = sc.min;
    maxCustomDimension.value = sc.max;
    maxCustomPixels.value = sc.maxPixels;
    minCustomPixels.value = sc.minPixels;
    maxAspectRatio.value = sc.maxAspectRatio;
    // 写入 companion 声明的分辨率档位（companion 声明、web 渲染）。
    resolutionOptions.value = status.resolutionOptions.map((o) => ({ ...o }));
    if (status.model) model.value = status.model;
    // 当前选中的背景/格式若已不在新 provider 支持列表，立即回退到第一个可用值。
    // 放在这里（同步）而非 watch，避免 UI 短暂停留在失效值上。
    if (!status.capability.backgrounds.includes(background.value)) {
      background.value = status.capability.backgrounds[0] ?? "auto";
    }
    if (!status.capability.outputFormats.includes(outputFormat.value)) {
      outputFormat.value = status.capability.outputFormats[0] ?? "png";
    }
    // 当前分辨率档若不在新 provider 声明的档位列表，回退到第一个可用档。
    // （如从豆包 [2k,3k,4k] 切到 GLM [1k,2k]，停在 4k 的要回退；从 GLM 切到豆包，停在 1k 的要回退）
    const availableValues = status.resolutionOptions.map((o) => o.value);
    if (!availableValues.includes(sizeResolution.value)) {
      sizeResolution.value = availableValues[0] ?? "1k";
    }
    // provider 约束变化时，即使档位值不变也要重算比例尺寸。
    const ratio = normalizeSizePreset(activeSizePreset.value);
    if (isSizeRatio(ratio)) applyRatioDimensions(ratio, sizeResolution.value);
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
    // model 不再强制写死：优先用持久化的值，companion 回流时会覆盖。
    // 兜底 FIXED_IMAGE_MODEL（兼容旧持久化数据无 model 字段的情况）。
    model.value = settings.model || FIXED_IMAGE_MODEL;
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
      model: model.value,
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
  watch(companionAccessKey, (v) =>
    writeStorage(SETTINGS_STORAGE_KEYS.companionAccessKey, v),
  );
  // Companion 模式只支持 Images API。切到 companion 时若残留 responses，
  // 强制校正为 images，避免发出注定抛「仅支持 Images API」的请求。
  // （apiMode 选择器 UI 仅在 direct 模式可见，切走后该值不会自动重置。）
  watch(connectionMode, (mode) => {
    if (mode === "localCompanion" && apiMode.value !== "images") {
      apiMode.value = "images";
    }
  });

  return {
    activeSizePreset,
    apiMode,
    apiBaseUrl,
    apiBaseUrlMode,
    apiKey,
    applyProviderInfo,
    providerCapability,
    autoRetryOnNetworkError,
    analyticsEnabled,
    analyticsPromptCapture,
    companionConnected,
    companionAccessKey,
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
    backgroundTagVisible,
    transparentDisabled,
    currentGenerationParams,
    currentSettings,
    currentSizeConstraints,
    customSizeError,
    formatLabel,
    formatOptions,
    formatTagVisible,
    favoritePrompts,
    imageCount,
    imageCountMode,
    imageCountPresets,
    minImageCount: MIN_IMAGE_COUNT,
    imageHeight,
    imageWidth,
    minCustomDimension,
    maxCustomDimension,
    sizeStep,
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
