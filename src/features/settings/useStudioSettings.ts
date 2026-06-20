import type { Ref } from "vue";
import { watch } from "vue";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../../stores/settingsStore";

type UseStudioSettingsInput = {
  isHydrated: Ref<boolean>;
  onStorageError: (error: unknown) => void;
};

export function useStudioSettings(input: UseStudioSettingsInput) {
  const settings = useSettingsStore();
  const refs = storeToRefs(settings);

  watch(
    [
      refs.connectionMode,
      refs.apiKey,
      refs.apiBaseUrl,
      refs.apiBaseUrlMode,
      refs.apiMode,
      refs.streamImages,
      refs.streamPartialImages,
      refs.model,
      refs.promptMode,
      refs.promptWordbanks,
      refs.promptRewriteGuardEnabled,
      refs.promptRewriteGuardText,
      refs.promptRewriteGuardHistory,
      refs.favoritePrompts,
      refs.autoRetryOnNetworkError,
      refs.analyticsEnabled,
      refs.analyticsPromptCapture,
      refs.activeSizePreset,
      refs.sizeResolution,
      refs.imageWidth,
      refs.imageHeight,
      refs.quality,
      refs.background,
      refs.outputFormat,
    ],
    () => {
      if (!input.isHydrated.value) return;
      void settings.saveCurrentSettings().catch(input.onStorageError);
    },
  );

  return {
    ...refs,
    applySettings: settings.applySettings,
    applyProviderInfo: settings.applyProviderInfo,
    applySizePreset: settings.applySizePreset,
    applySizeResolution: settings.applySizeResolution,
    currentGenerationParams: settings.currentGenerationParams,
    currentSettings: settings.currentSettings,
    deletePromptRewriteGuardHistoryItem:
      settings.deletePromptRewriteGuardHistoryItem,
    addFavoritePrompt: settings.addFavoritePrompt,
    updateFavoritePrompt: settings.updateFavoritePrompt,
    deleteFavoritePrompt: settings.deleteFavoritePrompt,
    restoreDefaultPromptRewriteGuardText:
      settings.restoreDefaultPromptRewriteGuardText,
    restorePromptRewriteGuardHistoryItem:
      settings.restorePromptRewriteGuardHistoryItem,
    restoreDefaultPromptWordbank: settings.restoreDefaultPromptWordbank,
    savePromptRewriteGuardText: settings.savePromptRewriteGuardText,
    savePromptWordbank: settings.savePromptWordbank,
    saveCurrentSettings: settings.saveCurrentSettings,
  };
}
