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
      refs.model,
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
    applySizePreset: settings.applySizePreset,
    applySizeResolution: settings.applySizeResolution,
    currentGenerationParams: settings.currentGenerationParams,
    currentSettings: settings.currentSettings,
    saveCurrentSettings: settings.saveCurrentSettings,
  };
}
