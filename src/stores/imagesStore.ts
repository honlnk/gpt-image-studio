import { computed, ref, watch, type WatchStopHandle } from "vue";
import { defineStore } from "pinia";
import type { ImageAssetServices } from "../services/imageAssets";
import { readImageDimensions } from "../services/imageMetadata";
import { toPlainImageAsset } from "../services/messageSerialization";
import type { StorageUsage, StorageUsageServices } from "../services/storageUsage";
import { isoTimestamp, timestampFromCreatedAt } from "../shared/dateTime";
import { formatError } from "../shared/errors";
import { createId } from "../shared/id";
import { createObjectUrl, revokeObjectUrls } from "../shared/objectUrls";
import { track } from "../features/analytics/useAnalyticsTracker";
import { useFeedbackStore } from "./feedbackStore";
import type { ImageAsset, Message } from "../types/studio";
import type { Ref } from "vue";

type ImagesStoreContext = {
  /** 阶段一 PR2：service 通过 context 注入（决策 T1）。
   *  imageMetadata/messageSerialization 暂留模块级 import（非存储层，不在阶段一范围）。
   *  storageUsage 必须走注入——它曾用模块级默认实例（无参 resolveStorage 恒为
   *  IndexedDbStorage），导致 Companion 模式下容量估算错读浏览器 IndexedDB。 */
  services: {
    imageAssets: ImageAssetServices;
    storageUsage: StorageUsageServices;
  };
  activeConversationId: Ref<string>;
  messages: Ref<Message[]>;
  onStorageError: (error: unknown) => void;
};

/** 图片库全局分页页大小（server 模式分页 PR-c）。 */
export const IMAGE_ASSETS_PAGE_SIZE = 100;

export const useImagesStore = defineStore("images", () => {
  const attachedImages = ref<string[]>([]);
  // imageAssets 语义（PR-c）：已加载窗口 = 全局第一页 + 当前会话全量 + 按需补加载，
  // 按 createdAt DESC 维护。不再是全量表。
  const imageAssets = ref<ImageAsset[]>([]);
  const storageUsage = ref<StorageUsage | null>(null);
  // ─── 分页状态（server 模式分页 PR-c） ───
  const assetsNextCursor = ref<string | null>(null);
  const assetsTotal = ref(0);
  const isLoadingMoreAssets = ref(false);
  /** 已完成全量加载的会话 id（切会话时聊天区引用/"当前会话"tab 完整性保证）。 */
  const assetsEnsuredConversationId = ref("");
  let ensureAssetsPromise: Promise<void> | null = null;
  let context: ImagesStoreContext | null = null;

  const activeAttachments = computed(() =>
    attachedImages.value
      .map((id) => imageAssets.value.find((image) => image.id === id))
      .filter((image): image is ImageAsset => Boolean(image)),
  );

  watch(
    imageAssets,
    (nextImages, previousImages) => {
      revokeRemovedPreviewUrls(previousImages, nextImages);
    },
    { flush: "post" },
  );

  let stopActiveConversationWatch: WatchStopHandle | null = null;

  function configureImagesStore(nextContext: ImagesStoreContext) {
    context = nextContext;
    // 切换会话时，新会话的图片自动插队到懒加载队首（createdAt 降序 = 最新的
    // 先加载，对齐"聊天区从最下面逐层向上"的体感）。重复 configure（连接模式
    // 切换重建 ViewModel）时先停旧 watch，避免叠加。
    stopActiveConversationWatch?.();
    stopActiveConversationWatch = watch(
      () => nextContext.activeConversationId.value,
      (conversationId) => {
        if (!conversationId) return;
        prioritizePreviews(
          imageAssets.value
            .filter((image) => image.conversationId === conversationId)
            .sort(
              (a, b) => timestampFromCreatedAt(b) - timestampFromCreatedAt(a),
            )
            .map((image) => image.id),
        );
      },
    );
  }

  function revokePreviewUrls() {
    revokeObjectUrls(imageAssets.value.map((image) => image.previewUrl));
  }

  function imageById(id: string) {
    return imageAssets.value.find((image) => image.id === id);
  }

  function attachImage(id: string) {
    if (!attachedImages.value.includes(id)) {
      attachedImages.value.push(id);
    }
  }

  function removeAttachment(id: string) {
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
  }

  async function deleteImage(id: string) {
    const image = imageById(id);
    if (!image) return;

    const input = getContext();
    const relatedMessages = input.messages.value.filter(
      (message) =>
        message.referencedImageIds.includes(id) ||
        message.resultImageIds.includes(id),
    );
    const isAttached = attachedImages.value.includes(id);

    const confirmMessage = relatedMessages.length || isAttached
      ? "这张图片正在被聊天记录或当前输入引用，删除后聊天记录中会保留无法显示的占位。确定删除吗？"
      : "确定从图片库中删除这张图片吗？";
    const feedback = useFeedbackStore();
    const confirmed = await feedback.requestConfirmation({
      title: "删除图片",
      description: confirmMessage,
      confirmLabel: "删除图片",
      tone: "danger",
    });
    if (!confirmed) return;

    attachedImages.value = attachedImages.value.filter((item) => item !== id);
    imageAssets.value = imageAssets.value.filter((item) => item.id !== id);

    try {
      await Promise.all([
        input.services.imageAssets.deleteAsset(id),
        image.blobKey ? input.services.imageAssets.deleteBlob(image.blobKey) : Promise.resolve(),
      ]);
      await refreshStorageUsage();
      feedback.notifySuccess("图片已删除。");
    } catch (error) {
      feedback.notifyError(`删除图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function deleteImages(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;

    const input = getContext();
    const feedback = useFeedbackStore();
    const deletedImages = imageAssets.value.filter((image) =>
      idSet.has(image.id),
    );
    attachedImages.value = attachedImages.value.filter((id) => !idSet.has(id));
    imageAssets.value = imageAssets.value.filter((image) => !idSet.has(image.id));

    try {
      await Promise.all(
        deletedImages.flatMap((image) => [
          input.services.imageAssets.deleteAsset(image.id),
          image.blobKey ? input.services.imageAssets.deleteBlob(image.blobKey) : Promise.resolve(),
        ]),
      );
      await refreshStorageUsage();
      feedback.notifySuccess(`已删除 ${deletedImages.length} 张图片。`);
    } catch (error) {
      feedback.notifyError(`删除图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function renameImage(id: string, nextName: string) {
    const image = imageById(id);
    if (!image) return false;

    const trimmedName = nextName.trim();
    if (!trimmedName) return false;

    const input = getContext();
    image.name = trimmedName;
    image.updatedAt = isoTimestamp();
    imageAssets.value = [
      image,
      ...imageAssets.value.filter((item) => item.id !== id),
    ];
    await input.services.imageAssets.saveAsset(toPlainImageAsset(image)).catch(input.onStorageError);
    return true;
  }

  async function setImageTagColor(id: string, nextColor?: ImageAsset["tagColor"]) {
    const image = imageById(id);
    if (!image) return false;

    const previousColor = image.tagColor;
    const input = getContext();
    image.tagColor = nextColor;
    image.updatedAt = isoTimestamp();
    imageAssets.value = [
      image,
      ...imageAssets.value.filter((item) => item.id !== id),
    ];
    await input.services.imageAssets.saveAsset(toPlainImageAsset(image)).catch(input.onStorageError);

    // 颜色分组事件分类：set（无→有）/ changed（有→不同）/ cleared（有→无）。
    const hadColor = Boolean(previousColor);
    const hasColor = Boolean(nextColor);
    if (hadColor !== hasColor || previousColor !== nextColor) {
      const eventName = !hadColor && hasColor
        ? "image.tag_color_set"
        : hadColor && !hasColor
          ? "image.tag_color_cleared"
          : "image.tag_color_changed";
      track(
        eventName,
        {
          imageId: id,
          previousColor: previousColor ?? null,
          newColor: nextColor ?? null,
          entry: "details",
        },
        "ui_click",
      );
    }
    return true;
  }

  async function importImages(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const input = getContext();
    const feedback = useFeedbackStore();
    try {
      const importedAssets = await Promise.all(
        imageFiles.map((file) => importImageFile(file)),
      );

      imageAssets.value = [...importedAssets, ...imageAssets.value];
      importedAssets.forEach((asset) => attachImage(asset.id));
      await refreshStorageUsage();
      feedback.notifySuccess(`已导入 ${importedAssets.length} 张图片并加入引用。`);
    } catch (error) {
      feedback.notifyError(`导入图片失败：${formatError(error)}`);
      input.onStorageError(error);
    }
  }

  async function importImageFile(file: File) {
    const input = getContext();
    const now = Date.now() + Math.floor(Math.random() * 1000);
    const createdAt = isoTimestamp(now);
    const dimensions = await readImageDimensions(file);
    const imageId = createId("img");
    const blobKey = createId("blob");
    const imageAsset: ImageAsset = {
      id: imageId,
      blobKey,
      name: file.name || `导入图片-${now}`,
      source: "imported",
      mimeType: file.type || "image/png",
      width: dimensions?.width,
      height: dimensions?.height,
      sizeBytes: file.size,
      conversationId: input.activeConversationId.value || undefined,
      prompt: "用户导入的参考图",
      createdAt,
      updatedAt: createdAt,
      previewUrl: createObjectUrl(file),
    };

    await Promise.all([
      input.services.imageAssets.saveBlob(blobKey, file),
      input.services.imageAssets.saveAsset(toPlainImageAsset(imageAsset)),
    ]).catch(input.onStorageError);

    return imageAsset;
  }

  async function createMaskAsset(sourceImage: ImageAsset, maskBlob: Blob) {
    const input = getContext();
    const now = Date.now();
    const createdAt = isoTimestamp(now);
    const imageId = createId("img");
    const maskAsset: ImageAsset = {
      id: imageId,
      blobKey: undefined,
      name: `${sourceImage.name}-编辑区域`,
      source: "generated",
      mimeType: "image/png",
      width: sourceImage.width,
      height: sourceImage.height,
      sizeBytes: maskBlob.size,
      conversationId: input.activeConversationId.value || undefined,
      prompt: "局部编辑遮罩",
      editSourceImageId: sourceImage.id,
      isEditMask: true,
      isTransientMask: true,
      transientBlob: maskBlob,
      createdAt,
      updatedAt: createdAt,
      previewUrl: createObjectUrl(maskBlob),
    };

    imageAssets.value = [maskAsset, ...imageAssets.value];
    return maskAsset;
  }

  function clearTransientMask(id: string) {
    const image = imageById(id);
    if (!image?.isTransientMask) return;
    attachedImages.value = attachedImages.value.filter((item) => item !== id);
    imageAssets.value = imageAssets.value.filter((item) => item.id !== id);
  }

  // ─── 预览懒加载（阶段三 PR9）───
  //
  // hydrate 只装配 metadata（previewUrl 留空），blob 按需加载：
  // - 当前会话图片由 configureImagesStore 的 watch / hydrate 自动插队队首；
  // - 其余图片由组件可见性（IntersectionObserver）或挂载时 ensurePreviewLoaded 触发。
  // 并发上限 2：OSS 后端带宽共享（实测聚合 ~10MB/s），并发越高每张越慢；
  // IndexedDB 本地读毫秒级，低并发也无感。
  //
  // 状态机：idle（previewStates 无记录）→ loading → loaded（以 previewUrl 存在
  // 表达，不记录）或 error（可重试）。组件据此区分"加载中"与"已删除"占位。
  const previewStates = ref<Record<string, "loading" | "error">>({});
  const previewQueue: string[] = [];
  const previewInFlight = new Set<string>();
  const PREVIEW_MAX_CONCURRENT = 2;

  function isPreviewLoading(id: string) {
    return previewStates.value[id] === "loading";
  }

  function isPreviewError(id: string) {
    return previewStates.value[id] === "error";
  }

  /** 按需加载单张预览。已加载/排队中/加载中去重；error 态可重试。 */
  function ensurePreviewLoaded(id: string) {
    const image = imageById(id);
    if (!image?.blobKey || image.previewUrl) return;
    if (previewInFlight.has(id) || previewQueue.includes(id)) return;
    previewQueue.push(id);
    pumpPreviewQueue();
  }

  /**
   * 把一组 id 插队到队首（保持传入顺序），用于当前会话图片优先加载。
   * 不在此处按 imageAssets 过滤——hydrate 调用时 imageAssets 尚未赋值，
   * 可加载性（blobKey 存在、无 previewUrl）由 pump 时校验，失效 id 自动跳过。
   */
  function prioritizePreviews(ids: string[]) {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const rest = previewQueue.filter((queued) => !idSet.has(queued));
    previewQueue.length = 0;
    previewQueue.push(...ids, ...rest);
    pumpPreviewQueue();
  }

  function pumpPreviewQueue() {
    while (previewInFlight.size < PREVIEW_MAX_CONCURRENT && previewQueue.length) {
      const id = previewQueue.shift()!;
      if (previewInFlight.has(id)) continue;
      const image = imageById(id);
      if (!image?.blobKey || image.previewUrl) continue;
      previewInFlight.add(id);
      previewStates.value = { ...previewStates.value, [id]: "loading" };
      void loadPreviewBlob(id).finally(() => {
        previewInFlight.delete(id);
        pumpPreviewQueue();
      });
    }
  }

  async function loadPreviewBlob(id: string) {
    const input = getContext();
    const image = imageById(id);
    if (!image?.blobKey) return;
    try {
      const blob = await input.services.imageAssets.loadBlob(image.blobKey);
      if (!blob) throw new Error(`图片二进制不存在：${image.blobKey}`);

      let nextAsset: ImageAsset = { ...image, previewUrl: createObjectUrl(blob) };
      if (!nextAsset.width || !nextAsset.height) {
        const dimensions = await readImageDimensions(blob);
        if (dimensions) {
          nextAsset = {
            ...nextAsset,
            width: dimensions.width,
            height: dimensions.height,
          };
          await input.services.imageAssets
            .saveAsset(toPlainImageAsset(nextAsset))
            .catch(input.onStorageError);
        }
      }
      imageAssets.value = imageAssets.value.map((item) =>
        item.id === id ? nextAsset : item,
      );
      const { [id]: _cleared, ...restStates } = previewStates.value;
      previewStates.value = restStates;
    } catch {
      // 加载失败只标记 error（组件显示"点击重试"），不上报 onStorageError——
      // 单张 blob 缺失/网络抖动不代表后端不可用。
      previewStates.value = { ...previewStates.value, [id]: "error" };
    }
  }

  async function refreshStorageUsage() {
    const input = getContext();
    storageUsage.value = await input.services.storageUsage.estimate().catch((error) => {
      input.onStorageError(error);
      return storageUsage.value;
    });
  }

  // ─── 分页加载（server 模式分页 PR-c） ───

  /** 合并去重写入（保持 createdAt DESC）。会话全量与全局页有重叠时不会重复。 */
  function mergeAssets(incoming: ImageAsset[]) {
    if (!incoming.length) return;
    const seen = new Set(imageAssets.value.map((asset) => asset.id));
    const fresh = incoming.filter((asset) => !seen.has(asset.id));
    if (!fresh.length) return;
    imageAssets.value = [...imageAssets.value, ...fresh].sort(
      (a, b) => timestampFromCreatedAt(b) - timestampFromCreatedAt(a),
    );
  }

  /** 启动恢复：加载全局第一页（整体替换）。返回本页数据供调用方做种子校验。 */
  async function loadAssetsFirstPage() {
    const page = await getContext().services.imageAssets.listAssetsPage({
      limit: IMAGE_ASSETS_PAGE_SIZE,
    });
    imageAssets.value = page.data;
    assetsNextCursor.value = page.nextCursor;
    assetsTotal.value = page.total;
    return page.data;
  }

  /** 图片库"全部图片"滚到底：追加下一页。 */
  async function loadMoreAssets() {
    const cursor = assetsNextCursor.value;
    if (!cursor || isLoadingMoreAssets.value) return;
    isLoadingMoreAssets.value = true;
    try {
      const page = await getContext().services.imageAssets.listAssetsPage({
        before: cursor,
        limit: IMAGE_ASSETS_PAGE_SIZE,
      });
      mergeAssets(page.data);
      assetsNextCursor.value = page.nextCursor;
      assetsTotal.value = page.total;
    } catch (error) {
      getContext().onStorageError(error);
    } finally {
      isLoadingMoreAssets.value = false;
    }
  }

  /**
   * 保证某会话的图片元数据全部加载（切会话时调用）：
   * 聊天区消息的图片引用、"当前会话"tab、草稿附件都依赖它完整。
   * 单会话图片量有限（几十张级），全量可接受。幂等 + 在飞去重。
   */
  async function ensureConversationAssets(conversationId: string) {
    if (!conversationId || assetsEnsuredConversationId.value === conversationId) {
      return;
    }
    if (ensureAssetsPromise) return ensureAssetsPromise;
    ensureAssetsPromise = (async () => {
      try {
        const assets =
          await getContext().services.imageAssets.listAssetsByConversation(conversationId);
        mergeAssets(assets);
        assetsEnsuredConversationId.value = conversationId;
        // service 返回 DESC（新→旧），插队队首让当前会话图片优先出图
        prioritizePreviews(assets.map((asset) => asset.id));
      } catch (error) {
        getContext().onStorageError(error);
      } finally {
        ensureAssetsPromise = null;
      }
    })();
    return ensureAssetsPromise;
  }

  /** 按需补加载窗口外的单张图片（草稿附件等）。 */
  async function ensureAssetsLoaded(ids: string[]) {
    const missing = ids.filter((id) => !imageById(id));
    if (!missing.length) return;
    try {
      const assets = await Promise.all(
        missing.map((id) => getContext().services.imageAssets.getAsset(id)),
      );
      mergeAssets(assets.filter((asset): asset is ImageAsset => Boolean(asset)));
    } catch (error) {
      getContext().onStorageError(error);
    }
  }

  /** 清空分页状态与图片窗口（备份导入等全量重置场景）。 */
  function resetPagination() {
    imageAssets.value = [];
    assetsNextCursor.value = null;
    assetsTotal.value = 0;
    assetsEnsuredConversationId.value = "";
  }

  function getContext() {
    if (!context) {
      throw new Error("Images store is not configured.");
    }

    return context;
  }

  return {
    activeAttachments,
    assetsEnsuredConversationId,
    assetsNextCursor,
    assetsTotal,
    attachedImages,
    imageAssets,
    isLoadingMoreAssets,
    previewStates,
    storageUsage,
    attachImage,
    clearTransientMask,
    configureImagesStore,
    createMaskAsset,
    deleteImage,
    deleteImages,
    ensureAssetsLoaded,
    ensureConversationAssets,
    ensurePreviewLoaded,
    imageById,
    importImages,
    isPreviewError,
    isPreviewLoading,
    loadAssetsFirstPage,
    loadMoreAssets,
    prioritizePreviews,
    refreshStorageUsage,
    removeAttachment,
    renameImage,
    resetPagination,
    revokePreviewUrls,
    setImageTagColor,
  };
});

function revokeRemovedPreviewUrls(
  previousImages: ImageAsset[] | undefined,
  nextImages: ImageAsset[],
) {
  if (!previousImages?.length) return;

  const nextPreviewUrls = new Set(
    nextImages
      .map((image) => image.previewUrl)
      .filter((url): url is string => Boolean(url)),
  );
  revokeObjectUrls(
    previousImages
      .map((image) => image.previewUrl)
      .filter((url) => url && !nextPreviewUrls.has(url)),
  );
}
