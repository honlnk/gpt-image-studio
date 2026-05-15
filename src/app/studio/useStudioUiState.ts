import { ref } from "vue";
import type { EditorKey } from "../../types/studio";

export function useStudioUiState() {
  const isSettingsOpen = ref(false);
  const isLibraryOpen = ref(false);
  const activeEditor = ref<EditorKey | null>(null);

  function toggleEditor(key: EditorKey) {
    activeEditor.value = activeEditor.value === key ? null : key;
  }

  function closeAllEditors() {
    activeEditor.value = null;
  }

  function openSettings() {
    isSettingsOpen.value = true;
  }

  function closeSettings() {
    isSettingsOpen.value = false;
  }

  return {
    activeEditor,
    closeAllEditors,
    closeSettings,
    isLibraryOpen,
    isSettingsOpen,
    openSettings,
    toggleEditor,
  };
}
