import { deleteConversation as deleteConversationRecord, listConversations } from "../services/conversations";
import { deleteImageAsset, deleteImageBlob, listImageAssets } from "../services/imageAssets";
import { deleteMessage, listMessages, saveMessage } from "../services/messages";
import { loadSettings } from "../services/settings";
import type { AppSettings, Conversation, ImageAsset, Message } from "../types/studio";
import type { Ref } from "vue";

type UseStudioRestoreInput = {
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
  async function restoreFromStorage() {
    try {
      const [savedSettings, savedConversations, savedMessages, savedImageAssets] =
        await Promise.all([
          loadSettings(),
          listConversations(),
          listMessages(),
          listImageAssets(),
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

  return {
    restoreFromStorage,
  };
}

function formatError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "图片接口返回了无法解析的响应。";
  }

  return error instanceof Error ? error.message : String(error);
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

async function persistNormalizedMessages(
  originalMessages: Message[],
  restoredMessages: Message[],
) {
  const changedMessages = restoredMessages.filter(
    (message, index) => message.status !== originalMessages[index]?.status,
  );

  if (!changedMessages.length) return;

  await Promise.all(changedMessages.map((message) => saveMessage(message)));
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
      deleteConversationRecord(conversation.id),
    ),
    ...staleMessages.map((message) => deleteMessage(message.id)),
    ...staleImages.map((image) => deleteImageAsset(image.id)),
    ...staleImages
      .map((image) => image.blobKey)
      .filter((blobKey): blobKey is string => Boolean(blobKey))
      .map((blobKey) => deleteImageBlob(blobKey)),
  ]);
}
