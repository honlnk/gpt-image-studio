import type { ConversationServices } from "../../services/conversations";
import type { ImageAssetServices } from "../../services/imageAssets";
import type { MessageServices } from "../../services/messages";
import type { ConfigServices, SettingsServices } from "../../services/settings";
import type { TimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { readStorage, writeStorage } from "../../shared/localStorage";
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
  /** companion 凭据 ref，用于迁移回填。
   *  权威存储是 localStorage 镜像（settingsStore 同步初始化 + watch 写回）；
   *  迁移逻辑负责：镜像为空时从旧 config（PR5 时代遗留）读回回填 ref 并补写镜像。 */
  companionUrl: Ref<string>;
  companionAccessKey: Ref<string>;
  /** 阶段三 PR5：qiankun 嵌入态。true 时连接配置由宿主注入，跳过凭据迁移。 */
  isEmbedded: Ref<boolean>;
};

const LEGACY_SEED_CONVERSATION_IDS = new Set(["c-1", "c-2", "c-3"]);
const LEGACY_SEED_MESSAGE_IDS = new Set(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
const LEGACY_SEED_IMAGE_IDS = new Set(["img-1", "img-2", "img-3", "img-4"]);

export function useStudioRestore(input: UseStudioRestoreInput) {
  const services = input.services;

  async function restoreFromStorage() {
    try {
      // companion 凭据迁移：localStorage 镜像为权威；镜像为空时从旧 config（PR5 遗留）
      // 读回回填 ref 并补写镜像。必须在 timeFieldMigration 之前、settings.load 之前执行。
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
   * companion 凭据迁移（T3 回滚后版）。
   *
   * companionUrl / companionAccessKey 的权威存储是 localStorage 镜像
   * （settingsStore 同步初始化 + watch 写回）。阶段一 PR5 曾把它们收编到
   * StudioStorage.config（IndexedDB __config__: 前缀）并清掉 localStorage——
   * 已回滚：连接配置存进「由它自己选中的后端」会形成鸡生蛋（Companion 模式下
   * 读 config 需要先拿到 accessKey，而 accessKey 又在 config 里，直接 401）。
   *
   * 这里负责收尾旧数据（localStorage 不再清除）：
   * 1) 镜像有值：以镜像为准（如备份导入刚写过镜像），同步回填 ref；
   * 2) 镜像为空但旧 config 有值（PR5 时代搬走的）：读回回填 ref + 补写镜像。
   *
   * apiKey / apiBaseUrl 走 settings 表的 "app" 记录（不变），这里只清 localStorage
   * 遗留入口，值由后续 settings.load + applySettings 读回覆盖 ref。
   */
  async function migrateCredentials() {
    const LEGACY_KEYS = {
      companionUrl: "gpt-image-studio:companion-url",
      companionAccessKey: "gpt-image-studio:companion-access-key",
      apiKey: "gpt-image-studio:api-key",
      apiBaseUrl: "gpt-image-studio:api-base-url",
    };

    // 嵌入态连接配置由宿主注入，不做任何迁移（同 settingsStore 的持久化跳过）。
    if (input.isEmbedded.value) return;

    // 1) companionUrl：镜像优先；镜像为空时从旧 config 回填并补写镜像
    const mirrorUrl = readStorage(LEGACY_KEYS.companionUrl, "");
    if (mirrorUrl) {
      if (input.companionUrl.value !== mirrorUrl) {
        input.companionUrl.value = mirrorUrl;
      }
    } else {
      const configUrl = await services.config.read<string>("companionUrl");
      if (configUrl) {
        input.companionUrl.value = configUrl;
        writeStorage(LEGACY_KEYS.companionUrl, configUrl);
      }
    }

    // 2) companionAccessKey：同上
    const mirrorKey = readStorage(LEGACY_KEYS.companionAccessKey, "");
    if (mirrorKey) {
      if (input.companionAccessKey.value !== mirrorKey) {
        input.companionAccessKey.value = mirrorKey;
      }
    } else {
      const configKey = await services.config.read<string>(
        "companionAccessKey",
      );
      if (configKey) {
        input.companionAccessKey.value = configKey;
        writeStorage(LEGACY_KEYS.companionAccessKey, configKey);
      }
    }

    // 3) apiKey / apiBaseUrl：只清 localStorage 遗留入口（运行时持久化本就走 settings 表）。
    //    它们的值由后续 settings.load + applySettings 从 settings 表读回覆盖 ref。
    const legacyApiKey = readStorage(LEGACY_KEYS.apiKey, "");
    const legacyApiBaseUrl = readStorage(LEGACY_KEYS.apiBaseUrl, "");
    if (legacyApiKey) {
      localStorage.removeItem(LEGACY_KEYS.apiKey);
    }
    if (legacyApiBaseUrl) {
      localStorage.removeItem(LEGACY_KEYS.apiBaseUrl);
    }

    // 4) 旧配对机制（7/15 前 pairing ceremony）的孤儿 key：session token 已失效，
    //    现无任何代码读取，不可用作 accessKey，直接清掉避免混淆。
    localStorage.removeItem("gpt-image-studio:companion-session-token");
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
