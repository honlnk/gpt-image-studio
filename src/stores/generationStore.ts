import { defineStore } from "pinia";
import type { ComputedRef, Ref } from "vue";
import { computed, ref, watch } from "vue";
import { track } from "../features/analytics/useAnalyticsTracker";
import type { GenerationJob } from "../features/generation/generationJobTypes";
import type { ImageClient } from "../features/generation/imageClients/imageClient";
import { notifyHostConversationsChanged } from "../services/embeddedBridge";
import { normalizeImageCount } from "../services/generationParams";
import type { ImageAssetServices } from "../services/imageAssets";
import type { MessageServices } from "../services/messages";
import { readImageDimensions } from "../services/imageMetadata";
import { resolveImageEditRequest } from "../services/imageEditRequest";
import {
  continuedGenerationLabel,
  outputFormatToMimeType,
  pendingGenerationLabel,
  pendingResultLabel,
  resultCountLabel,
  titleFromPrompt,
} from "../services/generationLabels";
import { toPlainImageAsset, toPlainMessage } from "../services/messageSerialization";
import { base64ToBlob } from "../shared/blobConverters";
import { isoTimestamp, timestampFromCreatedAt } from "../shared/dateTime";
import { formatError, isApiConfigurationError } from "../shared/errors";
import { createId } from "../shared/id";
import { createObjectUrl, revokeObjectUrl } from "../shared/objectUrls";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
  PromptRequestSettings,
} from "../types/studio";

type CreateConversationRecordInput = {
  title: string;
  summary: string;
  updatedAt: string;
};

type GenerationStoreContext = {
  /** 阶段一 PR2：存储服务通过 context 注入（决策 T1），store 不再模块级 import service。 */
  services: {
    imageAssets: ImageAssetServices;
    messages: MessageServices;
  };
  activeConversationId: Ref<string>;
  activeConversation: ComputedRef<Conversation | undefined>;
  attachedImages: Ref<string[]>;
  activeEditMaskImageId: Ref<string>;
  activeEditSourceImageId: Ref<string>;
  composerText: Ref<string>;
  createConversationRecord: (
    input: CreateConversationRecordInput,
  ) => Promise<Conversation>;
  currentGenerationParams: () => GenerationParams;
  currentPromptRequestSettings: () => PromptRequestSettings;
  customSizeError: ComputedRef<string>;
  imageAssets: Ref<ImageAsset[]>;
  imageById: (id: string) => ImageAsset | undefined;
  imageClient: ImageClient;
  messages: Ref<Message[]>;
  /** 当前 provider 是否支持图生图（带参考图编辑）。GLM-Image 无 edits 端点，为 false。 */
  supportsEdit: ComputedRef<boolean>;
  /** provider 不支持图生图、但用户带了参考图时，提交前的提示回调。 */
  notifyUnsupportedEdit: () => void;
  onApiConfigurationError?: (error: unknown) => void;
  onStorageError: (error: unknown) => void;
  conversationExists: (id: string) => boolean;
  persistConversation: (conversation: Conversation) => Promise<void>;
  refreshStorageUsage: () => Promise<void>;
  updateConversationSummary: (
    conversationId: string,
    text: string,
    summary: string,
    updatedAt?: string,
  ) => Conversation | null;
};

export const useGenerationStore = defineStore("generation", () => {
  const jobs = ref<GenerationJob[]>([]);
  const partialPreviewUrls = ref<Record<string, string>>({});
  let context: GenerationStoreContext | null = null;
  const messageSaveQueues = new Map<string, Promise<unknown>>();

  const input = computed(() => getContext());
  const pendingJobCount = computed(
    () => jobs.value.filter((job) => job.status === "pending").length,
  );
  const isGenerating = computed(() => pendingJobCount.value > 0);
  const activeConversationPendingJobs = computed(() =>
    jobs.value.filter(
      (job) =>
        job.status === "pending" &&
        job.conversationId === input.value.activeConversationId.value,
    ),
  );
  const pendingJobCountByConversation = computed(() => {
    const counts: Record<string, number> = {};
    jobs.value.forEach((job) => {
      if (job.status !== "pending") return;
      counts[job.conversationId] = (counts[job.conversationId] ?? 0) + 1;
    });
    return counts;
  });
  const imageModeLabel = computed(() =>
    input.value.activeEditMaskImageId.value &&
    input.value.activeEditSourceImageId.value
      ? "局部编辑"
      : input.value.attachedImages.value.length
        ? "引用图片编辑"
        : "文字生成图片",
  );
  const canSend = computed(
    () =>
      !input.value.customSizeError.value &&
      Boolean(
        input.value.composerText.value.trim() ||
        input.value.attachedImages.value.length,
      ),
  );
  let hasBeforeUnloadListener = false;

  watch(
    pendingJobCount,
    (count) => {
      if (typeof window === "undefined") return;

      if (count > 0 && !hasBeforeUnloadListener) {
        window.addEventListener("beforeunload", handleBeforeUnload);
        hasBeforeUnloadListener = true;
      } else if (count === 0 && hasBeforeUnloadListener) {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        hasBeforeUnloadListener = false;
      }
    },
    { immediate: true },
  );

  async function submitMessage() {
    if (!canSend.value) return;

    // 前置拦截：当前 provider 不支持图生图（如 GLM-Image 无 edits 端点），
    // 但用户带了参考图 → 提示并中止，避免发出注定 501 的请求。
    if (
      !input.value.supportsEdit.value &&
      input.value.attachedImages.value.length > 0
    ) {
      input.value.notifyUnsupportedEdit();
      return;
    }

    const now = Date.now();
    const createdAt = isoTimestamp(now);
    const text =
      input.value.composerText.value.trim() || "基于引用图片继续编辑。";
    const conversation =
      input.value.activeConversation.value ??
      (await input.value.createConversationRecord({
        title: titleFromPrompt(text),
        summary: imageModeLabel.value,
        updatedAt: createdAt,
      }));
    const conversationId = conversation.id;
    const editMaskImageId =
      input.value.activeEditMaskImageId.value || undefined;
    const references = input.value.attachedImages.value.filter(
      (id) => id !== editMaskImageId,
    );
    const editSourceImageId =
      input.value.activeEditSourceImageId.value || undefined;
    const generationParams = input.value.currentGenerationParams();
    const imageCount = normalizeImageCount(generationParams.imageCount);
    const promptRequestSettings = input.value.currentPromptRequestSettings();
    const userMessage: Message = {
      id: createId("m"),
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt,
      generationParams,
      promptRequestSettings,
    };
    const assistantMessage: Message = {
      id: createId("m"),
      conversationId,
      role: "assistant",
      content: pendingGenerationLabel(references.length > 0, imageCount),
      referencedImageIds: references,
      resultImageIds: [],
      status: "pending",
      createdAt: isoTimestamp(now + 1),
      generationStartedAt: createdAt,
      generationParams,
      promptRequestSettings,
      editSourceImageId,
      editMaskImageId,
    };

    clearPartialPreview(assistantMessage.id);
    input.value.messages.value.push(userMessage, assistantMessage);
    const updatedConversation = input.value.updateConversationSummary(
      conversationId,
      text,
      imageModeLabel.value,
      createdAt,
    );
    input.value.composerText.value = "";
    input.value.attachedImages.value = [];
    input.value.activeEditSourceImageId.value = "";
    input.value.activeEditMaskImageId.value = "";

    await Promise.all([
      input.value.services.messages.save(toPlainMessage(userMessage)),
      input.value.services.messages.save(toPlainMessage(assistantMessage)),
      updatedConversation
        ? input.value.persistConversation(updatedConversation)
        : Promise.resolve(),
    ]).catch(input.value.onStorageError);
    // 自动标题生效（会话未被手动重命名）→ 列表内容变了，补发宿主通知。
    // 嵌入态下子应用侧边栏隐藏（hideSidebar），标题展示完全依赖宿主重新拉列表；
    // 独立态 notifyHostConversationsChanged 是 no-op，无副作用。
    // 同时覆盖「发消息隐式建会话」场景——新会话标题同样来自本条输入。
    if (updatedConversation && !updatedConversation.isTitleManuallySet) {
      notifyHostConversationsChanged();
    }
    const createdJobs = createJobs(
      {
        assistantMessageId: assistantMessage.id,
        conversationId,
        generationParams:
          assistantMessage.generationParams ?? input.value.currentGenerationParams(),
        promptRequestSettings:
          assistantMessage.promptRequestSettings ??
          input.value.currentPromptRequestSettings(),
        prompt: text,
        referencedImageIds: references,
        editSourceImageId,
        editMaskImageId,
        userMessageId: userMessage.id,
      },
      imageCount,
    );
    track(
      "generation.requested",
      {
        imageCount,
        hasReferences: references.length > 0,
        hasMask: Boolean(editMaskImageId),
        size: generationParams.size,
        promptMode: promptRequestSettings.promptMode,
        quality: generationParams.quality,
        outputFormat: generationParams.outputFormat,
        background: generationParams.background,
        resolution: generationParams.resolution,
      },
      "system",
    );
    runImageRequests(createdJobs);
  }

  async function retryMessage(message: Message) {
    const generationParams =
      message.generationParams ?? input.value.currentGenerationParams();
    const imageCount = normalizeImageCount(generationParams.imageCount);
    message.status = "pending";
    message.generationStartedAt = isoTimestamp();
    message.content = pendingGenerationLabel(
      message.referencedImageIds.length > 0,
      imageCount,
    );
    message.errorMessage = undefined;
    clearPartialPreview(message.id);
    await input.value.services.messages.save(toPlainMessage(message)).catch(
      input.value.onStorageError,
    );

    const userMessage = [...input.value.messages.value]
      .reverse()
      .find(
        (item) =>
          item.conversationId === message.conversationId &&
          item.role === "user" &&
          timestampFromCreatedAt(item) <= timestampFromCreatedAt(message),
      );

    if (userMessage) {
      await Promise.all(
        createJobs(
          {
            assistantMessageId: message.id,
            conversationId: message.conversationId,
            generationParams,
            promptRequestSettings:
              message.promptRequestSettings ??
              input.value.currentPromptRequestSettings(),
            prompt: userMessage.content,
            referencedImageIds: message.referencedImageIds,
            editSourceImageId: message.editSourceImageId,
            editMaskImageId: message.editMaskImageId,
            userMessageId: userMessage.id,
          },
          imageCount,
        ).map(runImageRequest),
      );
    }
  }

  async function generateAnother(message: Message) {
    const generationParams =
      message.generationParams ?? input.value.currentGenerationParams();
    const promptRequestSettings =
      message.promptRequestSettings ?? input.value.currentPromptRequestSettings();
    track(
      "generation.requested",
      {
        imageCount: 1,
        hasReferences: message.referencedImageIds.length > 0,
        hasMask: Boolean(message.editMaskImageId),
        trigger: "generate_another",
        size: generationParams.size,
        promptMode: promptRequestSettings.promptMode,
        quality: generationParams.quality,
        outputFormat: generationParams.outputFormat,
        background: generationParams.background,
        resolution: generationParams.resolution,
      },
      "system",
    );
    await rerunMessageGeneration(message, {
      imageCount: 1,
      replaceImageId: undefined,
    });
  }

  async function refreshGeneratedImage(message: Message, imageId: string) {
    if (!message.resultImageIds.includes(imageId)) return;

    const image = input.value.imageById(imageId);
    input.value.imageAssets.value = input.value.imageAssets.value.filter(
      (item) => item.id !== imageId,
    );
    message.resultImageIds = message.resultImageIds.filter(
      (item) => item !== imageId,
    );
    await Promise.all([
      image ? input.value.services.imageAssets.deleteAsset(image.id) : Promise.resolve(),
      image?.blobKey ? input.value.services.imageAssets.deleteBlob(image.blobKey) : Promise.resolve(),
      enqueueMessageSave(message),
    ]).catch(input.value.onStorageError);
    await input.value.refreshStorageUsage();

    await rerunMessageGeneration(message, { replaceImageId: imageId });
  }

  async function rerunMessageGeneration(
    message: Message,
    options: { imageCount?: number; replaceImageId?: string | undefined },
  ) {
    const userMessage = findSourceUserMessage(message);
    if (!userMessage) return;

    const generationParams =
      message.generationParams ?? input.value.currentGenerationParams();
    const imageCount = options.replaceImageId
      ? 1
      : normalizeImageCount(options.imageCount ?? generationParams.imageCount);

    message.status = "pending";
    message.generationStartedAt = isoTimestamp();
    message.content = continuedGenerationLabel(
      message.referencedImageIds.length > 0,
      Boolean(options.replaceImageId),
      imageCount,
    );
    message.errorMessage = undefined;
    clearPartialPreview(message.id);
    replaceMessage(message);
    await enqueueMessageSave(message).catch(input.value.onStorageError);

    await Promise.all(
      createJobs(
        {
          assistantMessageId: message.id,
          conversationId: message.conversationId,
          generationParams,
          promptRequestSettings:
            message.promptRequestSettings ??
            input.value.currentPromptRequestSettings(),
          prompt: userMessage.content,
          referencedImageIds: message.referencedImageIds,
          editSourceImageId: message.editSourceImageId,
          editMaskImageId: message.editMaskImageId,
          userMessageId: userMessage.id,
        },
        imageCount,
      ).map(runImageRequest),
    );
  }

  async function runImageRequest(job: GenerationJob) {
    try {
      const params = job.generationParams;
      const onPartialImage = (event: { b64Json: string }) => {
        const assistantMessage = findMessage(job.assistantMessageId);
        if (!assistantMessage || assistantMessage.status !== "pending") return;

        updatePartialPreview(
          job.assistantMessageId,
          base64ToBlob(event.b64Json, outputFormatToMimeType(params.outputFormat)),
        );
      };
      const imageResult = job.referencedImageIds.length
        ? await requestImageEdit(
            job.prompt,
            job.referencedImageIds,
            params,
            job.promptRequestSettings,
            job.editSourceImageId,
            job.editMaskImageId,
            (retryAttempt) => updateMessageNetworkRetry(job.assistantMessageId, retryAttempt),
            onPartialImage,
          )
        : await input.value.imageClient.generate({
            prompt: job.prompt,
            params,
            promptRequestSettings: job.promptRequestSettings,
            onNetworkRetry: (retryAttempt) =>
              updateMessageNetworkRetry(job.assistantMessageId, retryAttempt),
            onPartialImage,
          });
      const now = Date.now();
      const createdAt = isoTimestamp(now);
      const generationDurationMs = Math.max(0, now - job.startedAtMs);
      // 优先用结果真实 MIME（companion 回流），回退 outputFormat 猜测（direct 模式无 mimeType）。
      const mimeType = imageResult.mimeType ?? outputFormatToMimeType(params.outputFormat);
      const blob = base64ToBlob(imageResult.b64Json, mimeType);
      const dimensions = await readImageDimensions(blob);
      const imageId = createId("img");
      const blobKey = createId("blob");
      const imageAsset: ImageAsset = {
        id: imageId,
        blobKey,
        name: titleFromPrompt(job.prompt),
        source: "generated",
        mimeType,
        width: dimensions?.width,
        height: dimensions?.height,
        sizeBytes: blob.size,
        conversationId: input.value.conversationExists(job.conversationId)
          ? job.conversationId
          : undefined,
        messageId: hasMessage(job.assistantMessageId)
          ? job.assistantMessageId
          : undefined,
        prompt: job.prompt,
        revisedPrompt: imageResult.revisedPrompt,
        referencedImageIds: job.referencedImageIds,
        editSourceImageId: job.editSourceImageId,
        generationDurationMs,
        createdAt,
        updatedAt: createdAt,
        previewUrl: createObjectUrl(blob),
      };

      input.value.imageAssets.value = [
        imageAsset,
        ...input.value.imageAssets.value,
      ];
      markJobSuccess(job.id);
      const assistantMessage = applyJobAggregateToMessage(job, {
        imageId,
      });

      track(
        "generation.succeeded",
        { imageId, generationDurationMs, messageId: job.assistantMessageId },
        "system",
      );

      const saveTasks: Promise<unknown>[] = [
        input.value.services.imageAssets.saveBlob(blobKey, blob),
        input.value.services.imageAssets.saveAsset(toPlainImageAsset(imageAsset)),
      ];
      if (assistantMessage) {
        saveTasks.push(enqueueMessageSave(assistantMessage));
      }
      try {
        await Promise.all(saveTasks);
      } catch (storageError) {
        // 图片已生成并在 UI 可见（内存 asset 已 push、job 已标记成功），
        // 这里是"本地保存失败"而非"生成失败"——单独走存储错误通道，
        // 不落入下方 catch 误标 markJobError（否则用户会看到"生成失败"但图已显示）。
        input.value.onStorageError(storageError);
      }
      await input.value.refreshStorageUsage();
    } catch (error) {
      const message = formatError(error);
      if (isApiConfigurationError(error)) {
        input.value.onApiConfigurationError?.(error);
      }
      markJobError(job.id, message);
      const assistantMessage = applyJobAggregateToMessage(job, {
        errorMessage: message,
      });
      track(
        "generation.failed",
        {
          errorMessage: message,
          messageId: job.assistantMessageId,
        },
        "system",
      );
      if (assistantMessage) {
        await enqueueMessageSave(assistantMessage).catch(
          input.value.onStorageError,
        );
      }
      await input.value.refreshStorageUsage();
    }
  }

  async function requestImageEdit(
    prompt: string,
    references: string[],
    params: GenerationParams,
    promptRequestSettings: PromptRequestSettings,
    editSourceImageId?: string,
    editMaskImageId?: string,
    onNetworkRetry?: (retryAttempt: number) => void,
    onPartialImage?: (event: { b64Json: string }) => void,
  ) {
    const resolved = await resolveImageEditRequest({
      prompt,
      references,
      params,
      promptRequestSettings,
      editSourceImageId,
      editMaskImageId,
      imageById: input.value.imageById,
      resolveBlob: resolveImageBlob,
    });

    return input.value.imageClient.edit({
      ...resolved,
      onNetworkRetry,
      onPartialImage,
    });
  }

  function updateMessageNetworkRetry(messageId: string, retryAttempt: number) {
    const assistantMessage = findMessage(messageId);
    if (!assistantMessage || assistantMessage.status !== "pending") return;

    assistantMessage.networkRetryAttempt = retryAttempt;
    replaceMessage(assistantMessage);
  }

  function replaceMessage(message: Message) {
    input.value.messages.value = input.value.messages.value.map((item) =>
      item.id === message.id ? { ...message } : item,
    );
  }

  function findMessage(messageId: string) {
    return input.value.messages.value.find((item) => item.id === messageId);
  }

  function findSourceUserMessage(message: Message) {
    return [...input.value.messages.value]
      .reverse()
      .find(
        (item) =>
          item.conversationId === message.conversationId &&
          item.role === "user" &&
          timestampFromCreatedAt(item) <= timestampFromCreatedAt(message),
      );
  }

  function hasMessage(messageId: string) {
    return Boolean(findMessage(messageId));
  }

  async function resolveImageBlob(image?: ImageAsset) {
    if (!image) return undefined;
    if (image.transientBlob) return image.transientBlob;
    if (!image.blobKey) return undefined;
    return input.value.services.imageAssets.loadBlob(image.blobKey);
  }

  function configureGenerationStore(nextContext: GenerationStoreContext) {
    context = nextContext;
  }

  function updatePartialPreview(messageId: string, blob: Blob) {
    const nextUrl = createObjectUrl(blob);
    const previousUrl = partialPreviewUrls.value[messageId];
    if (previousUrl) {
      revokeObjectUrl(previousUrl);
    }
    partialPreviewUrls.value = {
      ...partialPreviewUrls.value,
      [messageId]: nextUrl,
    };
  }

  function clearPartialPreview(messageId: string) {
    const previousUrl = partialPreviewUrls.value[messageId];
    if (!previousUrl) return;

    revokeObjectUrl(previousUrl);
    const { [messageId]: _removed, ...rest } = partialPreviewUrls.value;
    partialPreviewUrls.value = rest;
  }

  function getPartialPreviewUrl(messageId: string) {
    return partialPreviewUrls.value[messageId];
  }

  function createJob(
    jobInput: Omit<GenerationJob, "id" | "status" | "startedAtMs">,
  ): GenerationJob {
    const job: GenerationJob = {
      id: createId("job"),
      status: "pending",
      startedAtMs: Date.now(),
      ...jobInput,
    };
    jobs.value.push(job);
    return job;
  }

  function createJobs(
    jobInput: Omit<GenerationJob, "id" | "status" | "startedAtMs">,
    count: number,
  ) {
    return Array.from({ length: normalizeImageCount(count) }, () =>
      createJob(jobInput),
    );
  }

  function runImageRequests(createdJobs: GenerationJob[]) {
    createdJobs.forEach((job) => {
      void runImageRequest(job);
    });
  }

  function markJobSuccess(jobId: string) {
    const job = jobs.value.find((item) => item.id === jobId);
    if (!job) return;
    job.status = "success";
    job.finishedAtMs = Date.now();
    job.errorMessage = undefined;
  }

  function markJobError(jobId: string, errorMessage: string) {
    const job = jobs.value.find((item) => item.id === jobId);
    if (!job) return;
    job.status = "error";
    job.finishedAtMs = Date.now();
    job.errorMessage = errorMessage;
  }

  function applyJobAggregateToMessage(
    job: GenerationJob,
    update: { imageId?: string; errorMessage?: string },
  ) {
    const assistantMessage = findMessage(job.assistantMessageId);
    if (!assistantMessage) return undefined;

    if (update.imageId && !assistantMessage.resultImageIds.includes(update.imageId)) {
      assistantMessage.resultImageIds = [
        ...assistantMessage.resultImageIds,
        update.imageId,
      ];
    }

    const siblingJobs = jobs.value.filter(
      (item) => item.assistantMessageId === job.assistantMessageId,
    );
    const pendingCount = siblingJobs.filter((item) => item.status === "pending").length;
    const hasGeneratedImages = assistantMessage.resultImageIds.length > 0;
    const failedCount = siblingJobs.filter((item) => item.status === "error").length;

    assistantMessage.networkRetryAttempt = undefined;
    if (pendingCount > 0) {
      assistantMessage.status = "pending";
      assistantMessage.content = pendingResultLabel(
        job.referencedImageIds.length > 0,
        assistantMessage.resultImageIds.length,
        pendingCount,
      );
      assistantMessage.errorMessage =
        failedCount > 0
          ? `${failedCount} 张生成失败，其余仍在继续。`
          : undefined;
    } else if (hasGeneratedImages) {
      assistantMessage.status = "success";
      assistantMessage.content = job.referencedImageIds.length
        ? resultCountLabel("已基于引用图生成", assistantMessage.resultImageIds.length)
        : resultCountLabel("已生成", assistantMessage.resultImageIds.length);
      assistantMessage.errorMessage =
        failedCount > 0
          ? `${failedCount} 张生成失败，已保留成功结果。`
          : undefined;
    } else {
      assistantMessage.status = "error";
      assistantMessage.content = "生成中断，请重试。";
      assistantMessage.errorMessage = update.errorMessage ?? "生成失败，请重试。";
    }

    if (pendingCount === 0) {
      clearPartialPreview(job.assistantMessageId);
    }

    replaceMessage(assistantMessage);
    return assistantMessage;
  }

  function enqueueMessageSave(message: Message) {
    const previousSave =
      messageSaveQueues.get(message.id)?.catch(() => undefined) ??
      Promise.resolve();
    const saveTask = previousSave.then(() => {
      const latestMessage = findMessage(message.id) ?? message;
      return input.value.services.messages.save(toPlainMessage(latestMessage));
    });
    messageSaveQueues.set(message.id, saveTask);
    void saveTask.finally(() => {
      if (messageSaveQueues.get(message.id) === saveTask) {
        messageSaveQueues.delete(message.id);
      }
    }).catch(() => undefined);

    return saveTask;
  }

  function getContext() {
    if (!context) {
      throw new Error("Generation store is not configured.");
    }

    return context;
  }

  return {
    activeConversationPendingJobs,
    canSend,
    configureGenerationStore,
    imageModeLabel,
    isGenerating,
    pendingJobCountByConversation,
    pendingJobCount,
    generateAnother,
    getPartialPreviewUrl,
    refreshGeneratedImage,
    retryMessage,
    submitMessage,
  };
});

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
