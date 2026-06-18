import { createStudioBackup, restoreStudioBackup } from "../../services/backups";
import { track } from "../analytics/useAnalyticsTracker";
import { formatError } from "../../shared/errors";
import { createObjectUrl, revokeObjectUrl } from "../../shared/objectUrls";
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
    track("backup.export_requested", { kind: "project" }, "system");
    try {
      const backup = await createStudioBackup();
      const url = createObjectUrl(backup);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gpt-image-studio-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      anchor.click();
      revokeObjectUrl(url);
      track("backup.export_succeeded", { kind: "project", sizeBytes: backup.size }, "system");
      input.notifySuccess("备份已开始下载。");
    } catch (error) {
      track("backup.export_failed", { kind: "project" }, "system");
      input.notifyError(`导出备份失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function importBackup(file: File) {
    track("backup.import_requested", { kind: "project", sizeBytes: file.size }, "system");
    try {
      await restoreStudioBackup(file);
      input.conversations.value = [];
      input.messages.value = [];
      input.imageAssets.value = [];
      input.attachedImages.value = [];
      input.composerText.value = "";
      input.activeConversationId.value = "";
      await input.restoreFromStorage();
      track("backup.import_succeeded", { kind: "project" }, "system");
      input.notifySuccess("备份已恢复，本地数据已刷新。");
    } catch (error) {
      track("backup.import_failed", { kind: "project" }, "system");
      input.notifyError(`恢复备份失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  return {
    exportBackup,
    importBackup,
  };
}
