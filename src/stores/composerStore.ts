import { ref } from "vue";
import { defineStore } from "pinia";
import type { EditorKey } from "../types/studio";

export const useComposerStore = defineStore("composer", () => {
  const activeEditor = ref<EditorKey | null>(null);
  const composerText = ref("");
  const editModeEnabled = ref(false);
  const activeEditSourceImageId = ref("");
  const activeEditMaskImageId = ref("");
  const isLibraryOpen = ref(false);
  const isConversationSidebarOpen = ref(false);

  function toggleEditor(key: EditorKey) {
    activeEditor.value = activeEditor.value === key ? null : key;
  }

  function closeAllEditors() {
    activeEditor.value = null;
  }

  function setEditModeEnabled(value: boolean) {
    editModeEnabled.value = value;
    if (!value) {
      clearEditSelection();
    }
  }

  function applyEditSelection(sourceImageId: string, maskImageId: string) {
    activeEditSourceImageId.value = sourceImageId;
    activeEditMaskImageId.value = maskImageId;
  }

  function clearEditSelection() {
    activeEditSourceImageId.value = "";
    activeEditMaskImageId.value = "";
  }

  function openConversations() {
    isConversationSidebarOpen.value = true;
  }

  function setLibraryOpen(value: boolean) {
    isLibraryOpen.value = value;
  }

  return {
    activeEditor,
    activeEditMaskImageId,
    activeEditSourceImageId,
    composerText,
    editModeEnabled,
    isConversationSidebarOpen,
    isLibraryOpen,
    applyEditSelection,
    clearEditSelection,
    closeAllEditors,
    openConversations,
    setEditModeEnabled,
    setLibraryOpen,
    toggleEditor,
  };
});
