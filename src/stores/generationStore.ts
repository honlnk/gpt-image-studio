import { defineStore } from "pinia";
import type { ComputedRef, Ref } from "vue";
import { computed, ref, watch } from "vue";
import type { GenerationJob } from "../features/generation/generationJobTypes";
import type { ImageClient } from "../features/generation/imageClients/imageClient";
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
import { isoTimestamp, timestampFromCreatedAt } from "../shared/dateTime";
import { formatError, isApiConfigurationError } from "../shared/errors";
import { createId } from "../shared/id";
import { createObjectUrl } from "../shared/objectUrls";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
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
  let context: GenerationStoreContext | null = null;

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
    const userMessage: Message = {
      id: createId("m"),
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt,
      generationParams: input.value.currentGenerationParams(),
    };
    const assistantMessage: Message = {
      id: createId("m"),
      conversationId,
      role: "assistant",
      content: references.length
        ? "正在基于引用图片生成编辑结果。"
        : "正在生成图片。",
      referencedImageIds: references,
      resultImageIds: [],
      status: "pending",
      createdAt: isoTimestamp(now + 1),
      generationParams: input.value.currentGenerationParams(),
      editSourceImageId,
      editMaskImageId,
    };

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
    const job = createJob({
      assistantMessageId: assistantMessage.id,
      conversationId,
      generationParams:
        assistantMessage.generationParams ??
        input.value.currentGenerationParams(),
      prompt: text,
      referencedImageIds: references,
      editSourceImageId,
      editMaskImageId,
      userMessageId: userMessage.id,
    });
    void runImageRequest(job);
  }

  async function retryMessage(message: Message) {
    message.status = "pending";
    message.content = message.referencedImageIds.length
      ? "正在基于引用图片生成编辑结果。"
      : "正在生成图片。";
    message.resultImageIds = [];
    message.errorMessage = undefined;
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
      await runImageRequest(
        createJob({
          assistantMessageId: message.id,
          conversationId: message.conversationId,
          generationParams:
            message.generationParams ?? input.value.currentGenerationParams(),
          prompt: userMessage.content,
          referencedImageIds: message.referencedImageIds,
          editSourceImageId: message.editSourceImageId,
          editMaskImageId: message.editMaskImageId,
          userMessageId: userMessage.id,
        }),
      );
    }
  }

  async function generateAnother(message: Message) {
    await rerunMessageGeneration(message, { replaceImageId: undefined });
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
      saveMessage(toPlainMessage(message)),
    ]).catch(input.value.onStorageError);
    await input.value.refreshStorageUsage();

    await rerunMessageGeneration(message, { replaceImageId: imageId });
  }

  async function rerunMessageGeneration(
    message: Message,
    options: { replaceImageId?: string | undefined },
  ) {
    const userMessage = findSourceUserMessage(message);
    if (!userMessage) return;

    message.status = "pending";
    message.content = message.referencedImageIds.length
      ? options.replaceImageId
        ? "正在重新生成编辑结果。"
        : "正在继续生成编辑结果。"
      : options.replaceImageId
        ? "正在重新生成图片。"
        : "正在继续生成图片。";
    message.errorMessage = undefined;
    replaceMessage(message);
    await saveMessage(toPlainMessage(message)).catch(
      input.value.onStorageError,
    );

    await runImageRequest(
      createJob({
        assistantMessageId: message.id,
        conversationId: message.conversationId,
        generationParams:
          message.generationParams ?? input.value.currentGenerationParams(),
        prompt: userMessage.content,
        referencedImageIds: message.referencedImageIds,
        editSourceImageId: message.editSourceImageId,
        editMaskImageId: message.editMaskImageId,
        userMessageId: userMessage.id,
      }),
    );
  }

  async function runImageRequest(job: GenerationJob) {
    try {
      const params = job.generationParams;
      const imageResult = job.referencedImageIds.length
        ? await requestImageEdit(
            job.prompt,
            job.referencedImageIds,
            params,
            job.editSourceImageId,
            job.editMaskImageId,
          )
        : await input.value.imageClient.generate({
            prompt: job.prompt,
            params,
          });
      const now = Date.now();
      const createdAt = isoTimestamp(now);
      const generationDurationMs = Math.max(0, now - job.startedAtMs);
      const mimeType = `image/${params.outputFormat}`;
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

      const assistantMessage = findMessage(job.assistantMessageId);
      if (assistantMessage) {
        assistantMessage.status = "success";
        assistantMessage.content = job.referencedImageIds.length
          ? resultCountLabel("已基于引用图生成", assistantMessage.resultImageIds.length + 1)
          : resultCountLabel("已生成", assistantMessage.resultImageIds.length + 1);
        assistantMessage.resultImageIds = [
          ...assistantMessage.resultImageIds,
          imageId,
        ];
        assistantMessage.errorMessage = undefined;
        replaceMessage(assistantMessage);
      }
      input.value.imageAssets.value = [
        imageAsset,
        ...input.value.imageAssets.value,
      ];

      const saveTasks: Promise<unknown>[] = [
        saveImageBlob(blobKey, blob),
        saveImageAsset(toPlainImageAsset(imageAsset)),
      ];
      if (assistantMessage) {
        saveTasks.push(saveMessage(toPlainMessage(assistantMessage)));
      }
      await Promise.all(saveTasks);
      await input.value.refreshStorageUsage();
      markJobSuccess(job.id);
    } catch (error) {
      const message = formatError(error);
      if (isApiConfigurationError(error)) {
        input.value.onApiConfigurationError?.(error);
      }
      const assistantMessage = findMessage(job.assistantMessageId);
      if (assistantMessage) {
        assistantMessage.status = "error";
        assistantMessage.content = `生成失败：${message}`;
        assistantMessage.errorMessage = message;
        assistantMessage.resultImageIds = [];
        replaceMessage(assistantMessage);
        await saveMessage(toPlainMessage(assistantMessage)).catch(
          input.value.onStorageError,
        );
      }
      await input.value.refreshStorageUsage();
      markJobError(job.id, message);
    }
  }

  async function requestImageEdit(
    prompt: string,
    references: string[],
    params: GenerationParams,
    editSourceImageId?: string,
    editMaskImageId?: string,
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
    });
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

function resultCountLabel(prefix: string, count: number) {
  return count > 1 ? `${prefix} ${count} 张图片。` : `${prefix}一张图片。`;
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
    generationParams: message.generationParams
      ? { ...message.generationParams }
      : undefined,
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
