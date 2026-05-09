import { createStudioBackup, restoreStudioBackup } from "../../services/backups";
import { createObjectUrl, revokeObjectUrl } from "../../services/objectUrls";
import type { Conversation, ImageAsset, Message } from "../../types/studio";
import type { Ref } from "vue";

type UseStudioBackupInput = {
  activeConversationId: Ref<string>;
  attachedImages: Ref<string[]>;
  composerText: Ref<string>;
  conversations: Ref<Conversation[]>;
  imageAssets: Ref<ImageAsset[]>;
  messages: Ref<Message[]>;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  onStorageError: (error: unknown) => void;
  restoreFromStorage: () => Promise<void>;
};

export function useStudioBackup(input: UseStudioBackupInput) {
  async function exportBackup() {
    try {
      const backup = await createStudioBackup();
      const url = createObjectUrl(backup);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gpt-image-studio-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      anchor.click();
      revokeObjectUrl(url);
      input.notifySuccess("备份已开始下载。");
    } catch (error) {
      input.notifyError(`导出备份失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function importBackup(file: File) {
    try {
      await restoreStudioBackup(file);
      input.conversations.value = [];
      input.messages.value = [];
      input.imageAssets.value = [];
      input.attachedImages.value = [];
      input.composerText.value = "";
      input.activeConversationId.value = "";
      await input.restoreFromStorage();
      input.notifySuccess("备份已恢复，本地数据已刷新。");
    } catch (error) {
      input.notifyError(`恢复备份失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  return {
    exportBackup,
    importBackup,
  };
}

function formatError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "图片接口返回了无法解析的响应。";
  }

  return error instanceof Error ? error.message : String(error);
}
