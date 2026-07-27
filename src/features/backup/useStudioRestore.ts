import type { ConversationServices } from "../../services/conversations";
import type { ImageAssetServices } from "../../services/imageAssets";
import type { MessageServices } from "../../services/messages";
import type { SettingsServices } from "../../services/settings";
import type { TimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { formatError } from "../../shared/errors";
import type { AppSettings, Conversation, ImageAsset, Message } from "../../types/studio";
import type { Ref } from "vue";

/** 阶段一 PR2/PR4：restore 流程需要的 service 全集。
 *  由 ViewModel 在唯一装配点创建并注入（决策 T1 + §6.3）。 */
export type StudioRestoreServices = {
  conversations: ConversationServices;
  messages: MessageServices;
  imageAssets: ImageAssetServices;
  settings: SettingsServices;
  timeFieldMigration: TimeFieldMigrationServices;
};

type UseStudioRestoreInput = {
  services: StudioRestoreServices;
  activeConversationId: Ref<string>;
  applySettings: (settings: AppSettings) => void;
  attachedImages: Ref<string[]>;
  conversations: Ref<Conversation[]>;
  hydrateImagePreviews: (assets: ImageAsset[]) => Promise<ImageAsset[]>;
  imageAssets: Ref<ImageAsset[]>;
  isHydrated: Ref<boolean>;
  messages: Ref<Message[]>;
  notifyError: (message: string) => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
  saveCurrentSettings: () => Promise<void>;
};

const LEGACY_SEED_CONVERSATION_IDS = new Set(["c-1", "c-2", "c-3"]);
const LEGACY_SEED_MESSAGE_IDS = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
const LEGACY_SEED_IMAGE_IDS = new Set(["img-1", "img-2", "img-3", "img-4"]);

export function useStudioRestore(input: UseStudioRestoreInput) {
  const services = input.services;

  async function restoreFromStorage() {
    try {
      await services.timeFieldMigration.migrate();

      const [savedSettings, savedConversations, savedMessages, savedImageAssets] =
        await Promise.all([
          services.settings.load(),
          services.conversations.list(),
          services.messages.list(),
          services.imageAssets.listAssets(),
        ]);

      if (savedSettings) {
        input.applySettings(savedSettings);
      } else {
        await input.saveCurrentSettings();
      }

      await removeLegacySeedRecords(
        savedConversations,
        savedMessages,
        savedImageAssets,
      );

      const restoredConversations = savedConversations.filter(
        (conversation) => !LEGACY_SEED_CONVERSATION_IDS.has(conversation.id),
      );
      const restoredImages = savedImageAssets.filter(
        (image) =>
          !LEGACY_SEED_IMAGE_IDS.has(image.id) &&
          !(
            image.conversationId &&
            LEGACY_SEED_CONVERSATION_IDS.has(image.conversationId)
          ),
      );
      const restoredMessages = savedMessages.filter(
        (message) =>
          !LEGACY_SEED_MESSAGE_IDS.has(message.id) &&
          !LEGACY_SEED_CONVERSATION_IDS.has(message.conversationId),
      );

      input.conversations.value = restoredConversations;
      input.activeConversationId.value = restoredConversations[0]?.id ?? "";

      const normalizedMessages = normalizeRestoredMessages(restoredMessages);
      input.messages.value = normalizedMessages;
      await persistNormalizedMessages(restoredMessages, normalizedMessages);

      input.imageAssets.value = await input.hydrateImagePreviews(restoredImages);
      input.attachedImages.value = input.attachedImages.value.filter((id) =>
        restoredImages.some((image) => image.id === id),
      );
      await input.refreshStorageUsage();
    } catch (error) {
      input.notifyError(`读取本地数据失败：${formatError(error)}`);
      input.onStorageError(error);
    } finally {
      input.isHydrated.value = true;
    }
  }

  async function persistNormalizedMessages(
    originalMessages: Message[],
    restoredMessages: Message[],
  ) {
    const changedMessages = restoredMessages.filter(
      (message, index) => message.status !== originalMessages[index]?.status,
    );

    if (!changedMessages.length) return;

    await Promise.all(
      changedMessages.map((message) => services.messages.save(message)),
    );
  }

  async function removeLegacySeedRecords(
    conversations: Conversation[],
    messages: Message[],
    imageAssets: ImageAsset[],
  ) {
    const staleConversations = conversations.filter((conversation) =>
      LEGACY_SEED_CONVERSATION_IDS.has(conversation.id),
    );
    const staleMessages = messages.filter(
      (message) =>
        LEGACY_SEED_MESSAGE_IDS.has(message.id) ||
        LEGACY_SEED_CONVERSATION_IDS.has(message.conversationId),
    );
    const staleImages = imageAssets.filter(
      (image) =>
        LEGACY_SEED_IMAGE_IDS.has(image.id) ||
        Boolean(
          image.conversationId &&
            LEGACY_SEED_CONVERSATION_IDS.has(image.conversationId),
        ),
    );

    if (!staleConversations.length && !staleMessages.length && !staleImages.length) {
      return;
    }

    await Promise.all([
      ...staleConversations.map((conversation) =>
        services.conversations.remove(conversation.id),
      ),
      ...staleMessages.map((message) => services.messages.remove(message.id)),
      ...staleImages.map((image) => services.imageAssets.deleteAsset(image.id)),
      ...staleImages
        .map((image) => image.blobKey)
        .filter((blobKey): blobKey is string => Boolean(blobKey))
        .map((blobKey) => services.imageAssets.deleteBlob(blobKey)),
    ]);
  }

  return {
    restoreFromStorage,
  };
}

function normalizeRestoredMessages(messages: Message[]) {
  return messages.map((message) => {
    if (message.status !== "pending") return message;

    return {
      ...message,
      status: "error",
      content: "生成中断，请重试。",
      errorMessage: "页面刷新或会话中断后，未完成的生成任务不会继续运行。",
    } satisfies Message;
  });
}
