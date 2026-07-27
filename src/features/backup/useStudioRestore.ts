import type { ConversationServices } from "../../services/conversations";
import type { ImageAssetServices } from "../../services/imageAssets";
import type { MessageServices } from "../../services/messages";
import type { ConfigServices, SettingsServices } from "../../services/settings";
import type { TimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { readStorage } from "../../shared/localStorage";
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
  config: ConfigServices;
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
  /** 阶段一 PR5：companion 凭据 ref，用于迁移后回填（决策 T3）。
   *  ref 初始值仍由 settingsStore 同步从 localStorage 读（兜底），
   *  迁移逻辑负责把 localStorage 旧值搬到 config 并清 localStorage，
   *  二次启动时从 config 读回值赋给 ref。 */
  companionUrl: Ref<string>;
  companionAccessKey: Ref<string>;
};

const LEGACY_SEED_CONVERSATION_IDS = new Set(["c-1", "c-2", "c-3"]);
const LEGACY_SEED_MESSAGE_IDS = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
const LEGACY_SEED_IMAGE_IDS = new Set(["img-1", "img-2", "img-3", "img-4"]);

export function useStudioRestore(input: UseStudioRestoreInput) {
  const services = input.services;

  async function restoreFromStorage() {
    try {
      // 阶段一 PR5：companion 凭据 + apiKey/apiBaseUrl 从 localStorage 迁到 StudioStorage（决策 T3）。
      // 必须在 timeFieldMigration 之前、settings.load 之前执行。
      // ref 初始值已由 settingsStore 同步从 localStorage 读（兜底），这里负责：
      // 1) 把 localStorage 旧值搬到 config（IndexedDB）并清 localStorage
      // 2) 二次启动（localStorage 已清）时从 config 读回值回填 ref
      await migrateCredentials().catch(() => {
        // 迁移失败不阻塞 hydrate（ref 兜底值仍在，用户可重新输入）。
      });

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

  /**
   * 阶段一 PR5：companion 凭据迁移（决策 T3）。
   *
   * 时序安全（见 phase1-pr5 文档的时序分析）：
   * - ref 初始值已由 settingsStore 同步从 localStorage 读（兜底），保证 store setup
   *   早于 hydrate 时 useCompanionConnection 的 immediate watch 能拿到正确值。
   * - 这里把 localStorage 旧值搬到 config（IndexedDB __config__: 前缀），然后清 localStorage。
   * - 二次启动（localStorage 已清）时，从 config 读回值回填 ref。
   *
   * companionUrl / companionAccessKey 走 config 命名空间（不进 AppSettings 结构）。
   * apiKey / apiBaseUrl 走 settings 表的 "app" 记录（它们本就在 AppSettings 里，
   * saveCurrentSettings 会持久化）；这里只负责清掉 localStorage 遗留兜底入口。
   */
  async function migrateCredentials() {
    const LEGACY_KEYS = {
      companionUrl: "gpt-image-studio:companion-url",
      companionAccessKey: "gpt-image-studio:companion-access-key",
      apiKey: "gpt-image-studio:api-key",
      apiBaseUrl: "gpt-image-studio:api-base-url",
    };

    // 1) companionUrl：同步读 localStorage 旧值
    const legacyCompanionUrl = readStorage(
      LEGACY_KEYS.companionUrl,
      "",
    );
    if (legacyCompanionUrl) {
      await services.config.write("companionUrl", legacyCompanionUrl);
      localStorage.removeItem(LEGACY_KEYS.companionUrl);
      // ref 已是同值（settingsStore 同步读过），无需额外回填。
    } else {
      // 二次启动：localStorage 已清，从 config 读回值回填 ref
      const configUrl = await services.config.read<string>("companionUrl");
      if (configUrl) {
        input.companionUrl.value = configUrl;
      }
    }

    // 2) companionAccessKey：同上
    const legacyCompanionAccessKey = readStorage(
      LEGACY_KEYS.companionAccessKey,
      "",
    );
    if (legacyCompanionAccessKey) {
      await services.config.write(
        "companionAccessKey",
        legacyCompanionAccessKey,
      );
      localStorage.removeItem(LEGACY_KEYS.companionAccessKey);
    } else {
      const configKey = await services.config.read<string>(
        "companionAccessKey",
      );
      if (configKey) {
        input.companionAccessKey.value = configKey;
      }
    }

    // 3) apiKey / apiBaseUrl：只清 localStorage 遗留入口（运行时持久化本就走 IndexedDB settings 表）。
    //    它们的值由后续 settings.load + applySettings 从 IndexedDB 读回覆盖 ref。
    //    这里检测到 localStorage 有旧值就清掉，避免下次启动再用旧兜底。
    const legacyApiKey = readStorage(LEGACY_KEYS.apiKey, "");
    const legacyApiBaseUrl = readStorage(LEGACY_KEYS.apiBaseUrl, "");
    if (legacyApiKey) {
      localStorage.removeItem(LEGACY_KEYS.apiKey);
    }
    if (legacyApiBaseUrl) {
      localStorage.removeItem(LEGACY_KEYS.apiBaseUrl);
    }
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
