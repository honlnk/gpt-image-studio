import { nextTick, ref } from "vue";
import type { EditorKey } from "../types/studio";

export function useStudioUiState() {
  const isSettingsOpen = ref(false);
  const isLibraryOpen = ref(false);
  const activeEditor = ref<EditorKey | null>(null);
  const isEditorExpanded = ref(false);
  let expandTimer: ReturnType<typeof setTimeout> | null = null;

  function toggleEditor(key: EditorKey) {
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    if (activeEditor.value === key && isEditorExpanded.value) {
      // 关闭当前
      isEditorExpanded.value = false;
      expandTimer = setTimeout(() => {
        activeEditor.value = null;
        expandTimer = null;
      }, 200);
    } else {
      // 打开新的（先关闭再打开，避免内容跳变）
      isEditorExpanded.value = false;
      activeEditor.value = key;
      nextTick(() => {
        isEditorExpanded.value = true;
      });
    }
  }

  function closeAllEditors() {
    if (!activeEditor.value) return;
    if (expandTimer) {
      clearTimeout(expandTimer);
      expandTimer = null;
    }
    isEditorExpanded.value = false;
    expandTimer = setTimeout(() => {
      activeEditor.value = null;
      expandTimer = null;
    }, 200);
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
    isEditorExpanded,
    isLibraryOpen,
    isSettingsOpen,
    openSettings,
    toggleEditor,
  };
}
