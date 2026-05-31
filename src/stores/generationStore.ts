import { defineStore } from "pinia";
import type { ComputedRef, Ref } from "vue";
import { computed, ref, watch } from "vue";
import type { GenerationJob } from "../features/generation/generationJobTypes";
import type { ImageClient } from "../features/generation/imageClients/imageClient";
import { normalizeImageCount } from "../services/generationParams";
import {
  deleteImageAsset,
  deleteImageBlob,
  loadImageBlob,
  saveImageAsset,
  saveImageBlob,
} from "../services/imageAssets";
import { readImageDimensions } from "../services/imageMetadata";
import { base64ToBlob } from "../services/imagesApi";
import { saveMessage } from "../services/messages";
import { clonePromptWordbanks } from "../services/promptWordbanks";
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
      saveMessage(toPlainMessage(userMessage)),
      saveMessage(toPlainMessage(assistantMessage)),
      updatedConversation
        ? input.value.persistConversation(updatedConversation)
        : Promise.resolve(),
    ]).catch(input.value.onStorageError);
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
    await saveMessage(toPlainMessage(message)).catch(
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
      image ? deleteImageAsset(image.id) : Promise.resolve(),
      image?.blobKey ? deleteImageBlob(image.blobKey) : Promise.resolve(),
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
      const mimeType = outputFormatToMimeType(params.outputFormat);
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

      const saveTasks: Promise<unknown>[] = [
        saveImageBlob(blobKey, blob),
        saveImageAsset(toPlainImageAsset(imageAsset)),
      ];
      if (assistantMessage) {
        saveTasks.push(enqueueMessageSave(assistantMessage));
      }
      await Promise.all(saveTasks);
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
    const imageSources = await Promise.all(
      references.map(async (id) => {
        const reference = input.value.imageById(id);
        if (!reference) {
          throw new Error("引用图片不存在，请重新添加引用。");
        }
        const blob = await resolveImageBlob(reference);
        if (!blob) {
          throw new Error("无法读取引用图片文件，请重新生成或导入图片。");
        }

        return {
          id,
          blob,
          name: filenameFromAsset(reference),
        };
      }),
    );

    const totalBytes = imageSources.reduce((sum, img) => sum + img.blob.size, 0);
    const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
    if (totalBytes > MAX_PAYLOAD_BYTES) {
      const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
      throw new Error(
        `引用图片总大小为 ${totalMB}MB，超过 20MB 上限。请减少图片数量或压缩图片后重试。`,
      );
    }

    const sourceImage = editSourceImageId
      ? input.value.imageById(editSourceImageId)
      : undefined;
    const maskImage = editMaskImageId
      ? input.value.imageById(editMaskImageId)
      : undefined;
    let maskBlob: Blob | undefined;
    if (maskImage) {
      maskBlob = await resolveImageBlob(maskImage);
      if (!maskBlob) {
        throw new Error("无法读取编辑遮罩文件，请重新选择编辑区域。");
      }
      if (maskBlob.type !== "image/png") {
        throw new Error("编辑遮罩必须是 PNG 文件，请重新选择编辑区域。");
      }
    }

    const editImages = editSourceImageId
      ? imageSources.filter((image) => image.id === editSourceImageId)
      : imageSources;
    if (editSourceImageId && !editImages.length) {
      throw new Error("编辑源图不在当前引用列表中，请重新选择继续编辑。");
    }
    if (editMaskImageId && !maskImage) {
      throw new Error("编辑遮罩不存在，请重新选择编辑区域。");
    }
    if (editMaskImageId && !editSourceImageId) {
      throw new Error("缺少编辑源图，无法使用局部编辑。");
    }
    if (maskBlob && sourceImage) {
      const sourceBlob = await resolveImageBlob(sourceImage);
      if (!sourceBlob) {
        throw new Error("无法读取编辑源图，请重新引用图片。");
      }
      const [sourceSize, maskSize] = await Promise.all([
        readImageDimensions(sourceBlob),
        readImageDimensions(maskBlob),
      ]);
      if (
        sourceSize &&
        maskSize &&
        (sourceSize.width !== maskSize.width ||
          sourceSize.height !== maskSize.height)
      ) {
        throw new Error("编辑遮罩尺寸与源图不一致，请重新选择编辑区域。");
      }
    }

    if (maskBlob) {
      console.info(
        "[generation] edit with mask",
        JSON.stringify({
          prompt: prompt.slice(0, 80),
          sourceImageId: editSourceImageId,
          maskImageId: editMaskImageId,
          referenceCount: references.length,
          sentImageCount: (editImages.length ? editImages : imageSources)
            .length,
        }),
      );
    }

    return input.value.imageClient.edit({
      prompt,
      params,
      promptRequestSettings,
      images: (editImages.length ? editImages : imageSources).map((item) => ({
        blob: item.blob,
        name: item.name,
      })),
      mask: maskBlob
        ? {
            blob: maskBlob,
            name: "mask.png",
          }
        : undefined,
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
    return loadImageBlob(image.blobKey);
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
      return saveMessage(toPlainMessage(latestMessage));
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

function titleFromPrompt(prompt: string) {
  return prompt.length > 16 ? `${prompt.slice(0, 16)}...` : prompt;
}

function filenameFromAsset(asset: ImageAsset) {
  const extension =
    asset.mimeType === "image/jpeg"
      ? "jpeg"
      : asset.mimeType === "image/webp"
        ? "webp"
        : "png";

  return `${asset.name || asset.id}.${extension}`;
}

function outputFormatToMimeType(outputFormat: GenerationParams["outputFormat"]) {
  return outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
}

function resultCountLabel(prefix: string, count: number) {
  return count > 1 ? `${prefix} ${count} 张图片。` : `${prefix}一张图片。`;
}

function pendingGenerationLabel(isEdit: boolean, count: number) {
  if (isEdit) {
    return count > 1
      ? `正在基于引用图片生成 ${count} 张编辑结果。`
      : "正在基于引用图片生成编辑结果。";
  }

  return count > 1 ? `正在生成 ${count} 张图片。` : "正在生成图片。";
}

function continuedGenerationLabel(
  isEdit: boolean,
  isReplacing: boolean,
  count: number,
) {
  if (isEdit) {
    if (isReplacing) return "正在重新生成编辑结果。";
    return count > 1
      ? `正在继续生成 ${count} 张编辑结果。`
      : "正在继续生成编辑结果。";
  }

  if (isReplacing) return "正在重新生成图片。";
  return count > 1 ? `正在继续生成 ${count} 张图片。` : "正在继续生成图片。";
}

function pendingResultLabel(
  isEdit: boolean,
  generatedCount: number,
  pendingCount: number,
) {
  const generatedPart =
    generatedCount > 0 ? `已生成 ${generatedCount} 张，` : "";
  const noun = isEdit ? "编辑结果" : "图片";
  return `${generatedPart}还有 ${pendingCount} 张${noun}正在生成。`;
}

function toPlainMessage(message: Message): Message {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    referencedImageIds: [...message.referencedImageIds],
    resultImageIds: [...message.resultImageIds],
    status: message.status,
    createdAt: message.createdAt,
    generationStartedAt: message.generationStartedAt,
    generationParams: message.generationParams
      ? { ...message.generationParams }
      : undefined,
    promptRequestSettings: message.promptRequestSettings
      ? {
          promptMode: message.promptRequestSettings.promptMode,
          promptWordbanks: clonePromptWordbanks(
            message.promptRequestSettings.promptWordbanks,
          ),
          promptRewriteGuardEnabled:
            message.promptRequestSettings.promptRewriteGuardEnabled,
          promptRewriteGuardText:
            message.promptRequestSettings.promptRewriteGuardText,
        }
      : undefined,
    networkRetryAttempt: message.networkRetryAttempt,
    errorMessage: message.errorMessage,
    editSourceImageId: message.editSourceImageId,
    editMaskImageId: message.editMaskImageId,
  };
}

function toPlainImageAsset(imageAsset: ImageAsset): ImageAsset {
  return {
    id: imageAsset.id,
    blobKey: imageAsset.blobKey,
    name: imageAsset.name,
    source: imageAsset.source,
    tagColor: imageAsset.tagColor,
    mimeType: imageAsset.mimeType,
    width: imageAsset.width,
    height: imageAsset.height,
    sizeBytes: imageAsset.sizeBytes,
    conversationId: imageAsset.conversationId,
    messageId: imageAsset.messageId,
    prompt: imageAsset.prompt,
    revisedPrompt: imageAsset.revisedPrompt,
    referencedImageIds: imageAsset.referencedImageIds
      ? [...imageAsset.referencedImageIds]
      : undefined,
    editSourceImageId: imageAsset.editSourceImageId,
    generationDurationMs: imageAsset.generationDurationMs,
    isEditMask: imageAsset.isEditMask,
    createdAt: imageAsset.createdAt,
    updatedAt: imageAsset.updatedAt,
  };
}
