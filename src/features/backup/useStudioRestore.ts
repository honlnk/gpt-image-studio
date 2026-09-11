import type { ConversationServices } from "../../services/conversations";
import type { ImageAssetServices } from "../../services/imageAssets";
import type { MessageServices } from "../../services/messages";
import type { SettingsServices } from "../../services/settings";
import type { TimeFieldMigrationServices } from "../../services/timeFieldMigration";
import { readStorage } from "../../shared/localStorage";
import { formatError } from "../../shared/errors";
import { readConversationIdFromUrl } from "../../services/conversationUrl";
import { isDesktopCompanionActive } from "../../services/desktopCompanion";
import type { AppSettings, Conversation, ImageAsset } from "../../types/studio";
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

/**
 * restore 输入（PR-c 按需加载版）。
 *
 * 不再接收 conversations/messages/imageAssets 三个 ref 直接赋值——
 * 分页状态（游标/total/窗口归属）由 store 持有，restore 通过 store 动作驱动加载：
 * - 会话只拉第一页（侧边栏滚到底再翻页，PR-d）；
 * - messages 只拉激活会话最新一页（向上滚动翻更早，PR-d）；
 * - imageAssets 拉全局第一页 + 当前会话全量（聊天区引用/"当前会话"tab 完整性）。
 * 数据量再大涨，启动耗时基本恒定。
 */
type UseStudioRestoreInput = {
  services: StudioRestoreServices;
  activeConversationId: Ref<string>;
  applySettings: (settings: AppSettings) => void;
  attachedImages: Ref<string[]>;
  isHydrated: Ref<boolean>;
  notifyError: (message: string) => void;
  onStorageError: (error: unknown) => void;
  refreshStorageUsage: () => Promise<void>;
  saveCurrentSettings: () => Promise<void>;
  /** 清空两个 store 的分页状态与窗口（备份导入后 restore 重跑时的前置重置）。 */
  resetPagination: () => void;
  /** conversationsStore：加载会话第一页（整体替换），返回本页数据。 */
  loadConversationsFirstPage: () => Promise<Conversation[]>;
  /** conversationsStore：加载某会话消息窗口（最新一页，含中断消息归一化）。 */
  loadConversationMessages: (conversationId: string) => Promise<void>;
  /** imagesStore：加载图片全局第一页（整体替换），返回本页数据。 */
  loadAssetsFirstPage: () => Promise<ImageAsset[]>;
  /** imagesStore：保证某会话图片元数据全量加载。 */
  ensureConversationAssets: (conversationId: string) => Promise<void>;
  /** companion 凭据 ref，用于迁移回填。
   *  权威存储是 localStorage 镜像（settingsStore 同步初始化 + watch 写回）；
   *  迁移逻辑负责：备份导入刚写过镜像时，把镜像值同步到内存 ref。 */
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
      // companion 凭据迁移：localStorage 镜像为权威，备份导入刚写过镜像时
      // 同步到内存 ref。必须在 timeFieldMigration 之前、settings.load 之前执行。
      await migrateCredentials().catch(() => {
        // 迁移失败不阻塞 hydrate（ref 兜底值仍在，用户可重新输入）。
      });

      await services.timeFieldMigration.migrate();

      const savedSettings = await services.settings.load();
      if (savedSettings) {
        input.applySettings(savedSettings);
      } else {
        await input.saveCurrentSettings();
      }

      // 备份导入后 restore 会重跑：先清掉旧窗口/游标，再按分页模型重新加载
      input.resetPagination();
      input.attachedImages.value = [];

      // ─── 会话第一页（PR-c：不再全量） ───
      let restoredConversations = await input.loadConversationsFirstPage();
      // legacy 演示种子（早期版本的 c-1/m-1/img-1）只可能在已加载页里发现——
      // 它们按时间排在最尾，大数据集第一页之外的老种子会残留，属于可接受的
      // 上古 dev 时代产物（真实用户的库早在历次启动的全量时代清理干净了）。
      if (await removeLegacySeedRecords(restoredConversations)) {
        restoredConversations = await input.loadConversationsFirstPage();
      }

      // 首次激活优先用 URL 里的 ?c=<id>（阶段三 PR7 §2.2 读侧）。
      // id 不在第一页时 getById 兜底验证（URL 可能指向翻页区之外的会话）；
      // 无效 id（已删除/其它后端，D1 数据集隔离）静默回落第一个，不报错。
      const urlConversationId = readConversationIdFromUrl();
      let activeId = "";
      if (urlConversationId) {
        const exists =
          restoredConversations.some((c) => c.id === urlConversationId) ||
          Boolean(await services.conversations.getById(urlConversationId));
        if (exists) activeId = urlConversationId;
      }
      if (!activeId) {
        activeId = restoredConversations[0]?.id ?? "";
      }
      input.activeConversationId.value = activeId;

      // ─── 图片：全局第一页（"全部图片"tab），之后当前会话全量合并 ───
      const assetsPage = await input.loadAssetsFirstPage();
      if (await removeLegacySeedImages(assetsPage)) {
        await input.loadAssetsFirstPage();
      }

      // ─── 当前会话：消息窗口 + 图片全量（并发） ───
      // ViewModel 的 activeConversationId watch 也会触发这两个加载，
      // store 内部幂等去重（窗口已是该会话 / ensure 在飞去重），不重复拉取。
      await Promise.all([
        input.loadConversationMessages(activeId),
        input.ensureConversationAssets(activeId),
      ]);

      await input.refreshStorageUsage();
    } catch (error) {
      input.notifyError(`读取本地数据失败：${formatError(error)}`);
      input.onStorageError(error);
    } finally {
      input.isHydrated.value = true;
    }
  }

  /**
   * legacy 演示种子清理（早期版本内置的 c-1/m-1 假数据）。
   * 仅当会话第一页里发现种子会话时才触发全量清理；返回是否发生了删除。
   * 删除一律是 no-op 安全的（key 不存在不报错），可直接按 id 盲删。
   */
  async function removeLegacySeedRecords(
    conversationsPage: Conversation[],
  ): Promise<boolean> {
    const hasSeeds = conversationsPage.some((c) =>
      LEGACY_SEED_CONVERSATION_IDS.has(c.id),
    );
    if (!hasSeeds) return false;

    const seedConversationIds = [...LEGACY_SEED_CONVERSATION_IDS];
    const seedMessages = (
      await Promise.all(
        seedConversationIds.map((id) => services.messages.listByConversationId(id)),
      )
    ).flat();
    const seedImages = (
      await Promise.all(
        seedConversationIds.map((id) =>
          services.imageAssets.listAssetsByConversation(id),
        ),
      )
    ).flat();

    await Promise.all([
      ...seedConversationIds.map((id) => services.conversations.remove(id)),
      ...seedMessages.map((message) => services.messages.remove(message.id)),
      ...[...LEGACY_SEED_MESSAGE_IDS].map((id) => services.messages.remove(id)),
      ...seedImages.map((image) => services.imageAssets.deleteAsset(image.id)),
      ...seedImages
        .map((image) => image.blobKey)
        .filter((blobKey): blobKey is string => Boolean(blobKey))
        .map((blobKey) => services.imageAssets.deleteBlob(blobKey)),
      ...[...LEGACY_SEED_IMAGE_IDS].map((id) =>
        services.imageAssets.deleteAsset(id),
      ),
    ]);
    return true;
  }

  /** 种子图片可能在图片第一页（无归属会话的 img-1..4）。返回是否发生了删除。 */
  async function removeLegacySeedImages(
    assetsPage: ImageAsset[],
  ): Promise<boolean> {
    const staleImages = assetsPage.filter((image) =>
      LEGACY_SEED_IMAGE_IDS.has(image.id),
    );
    if (!staleImages.length) return false;
    await Promise.all(
      staleImages.flatMap((image) => [
        services.imageAssets.deleteAsset(image.id),
        image.blobKey
          ? services.imageAssets.deleteBlob(image.blobKey)
          : Promise.resolve(),
      ]),
    );
    return true;
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
   * 这里只做「镜像 → 内存 ref」的同步（备份导入刚写过镜像时需要），不再回查
   * 旧 config——PR5 从未发布到 main（仅在 dev 分支存活 4 天即回滚），没有真实
   * 用户的 IndexedDB config 里会留有这两个键，去捞必然落空（Companion 模式下
   * 更是向 Companion 数据集发必然 404 的请求）。
   *
   * apiKey / apiBaseUrl 走 settings 表的 "app" 记录（不变），这里只清 localStorage
   * 遗留入口，值由后续 settings.load + applySettings 从 settings 表读回覆盖 ref。
   */
  async function migrateCredentials() {
    const LEGACY_KEYS = {
      companionUrl: "gpt-image-studio:companion-url",
      companionAccessKey: "gpt-image-studio:companion-access-key",
      apiKey: "gpt-image-studio:api-key",
      apiBaseUrl: "gpt-image-studio:api-base-url",
    };

    // 嵌入态连接配置由宿主注入，不做任何迁移（同 settingsStore 的持久化跳过）。
    // 桌面内置态同理——镜像里的 url/key 可能属于浏览器侧配对的外部 Companion，
    // 同步会覆盖 sidecar 注入的连接（dev 模式下两者共享 localStorage origin）。
    if (input.isEmbedded.value || isDesktopCompanionActive()) return;

    // 1) companionUrl：镜像优先。备份导入会写镜像，这里同步到内存 ref。
    const mirrorUrl = readStorage(LEGACY_KEYS.companionUrl, "");
    if (mirrorUrl && input.companionUrl.value !== mirrorUrl) {
      input.companionUrl.value = mirrorUrl;
    }

    // 2) companionAccessKey：同上
    const mirrorKey = readStorage(LEGACY_KEYS.companionAccessKey, "");
    if (mirrorKey && input.companionAccessKey.value !== mirrorKey) {
      input.companionAccessKey.value = mirrorKey;
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
