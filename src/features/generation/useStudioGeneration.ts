import { computed } from "vue";
import { isoTimestamp, timestampFromCreatedAt } from "../../shared/dateTime";
import { formatError } from "../../shared/errors";
import { createId } from "../../shared/id";
import { saveImageAsset, saveImageBlob, loadImageBlob } from "../../services/imageAssets";
import { base64ToBlob } from "../../services/imagesApi";
import { readImageDimensions } from "../../services/imageMetadata";
import { saveMessage } from "../../services/messages";
import { createObjectUrl } from "../../shared/objectUrls";
import type { ImageClient } from "./imageClients/imageClient";
import { useGenerationJobs } from "./useGenerationJobs";
import type { GenerationJob } from "./generationJobTypes";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
} from "../../types/studio";
import type { ComputedRef, Ref } from "vue";

type CreateConversationRecordInput = {
  title: string;
  summary: string;
  updatedAt: string;
};

type UseStudioGenerationInput = {
  activeConversationId: Ref<string>;
  activeConversation: ComputedRef<Conversation | undefined>;
  attachedImages: Ref<string[]>;
  composerText: Ref<string>;
  createConversationRecord: (input: CreateConversationRecordInput) => Promise<Conversation>;
  currentGenerationParams: () => GenerationParams;
  customSizeError: ComputedRef<string>;
  imageAssets: Ref<ImageAsset[]>;
  imageById: (id: string) => ImageAsset | undefined;
  imageClient: ImageClient;
  messages: Ref<Message[]>;
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

export function useStudioGeneration(input: UseStudioGenerationInput) {
  const jobs = useGenerationJobs(input.activeConversationId);
  const isGenerating = jobs.isGenerating;
  const imageModeLabel = computed(() =>
    input.attachedImages.value.length ? "引用图片编辑" : "文字生成图片",
  );
  const canSend = computed(() =>
    !input.customSizeError.value &&
    Boolean(input.composerText.value.trim() || input.attachedImages.value.length),
  );

  async function submitMessage() {
    if (!canSend.value) return;

    const now = Date.now();
    const createdAt = isoTimestamp(now);
    const text = input.composerText.value.trim() || "基于引用图片继续编辑。";
    const conversation =
      input.activeConversation.value ??
      await input.createConversationRecord({
        title: titleFromPrompt(text),
        summary: imageModeLabel.value,
        updatedAt: createdAt,
      });
    const conversationId = conversation.id;
    const references = [...input.attachedImages.value];
    const userMessage: Message = {
      id: createId("m"),
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt,
      generationParams: input.currentGenerationParams(),
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
      generationParams: input.currentGenerationParams(),
    };

    input.messages.value.push(userMessage, assistantMessage);
    const updatedConversation = input.updateConversationSummary(
      conversationId,
      text,
      imageModeLabel.value,
      createdAt,
    );
    input.composerText.value = "";
    input.attachedImages.value = [];

    await Promise.all([
      saveMessage(toPlainMessage(userMessage)),
      saveMessage(toPlainMessage(assistantMessage)),
      updatedConversation
        ? input.persistConversation(updatedConversation)
        : Promise.resolve(),
    ]).catch(input.onStorageError);
    const job = jobs.createJob({
      assistantMessageId: assistantMessage.id,
      conversationId,
      generationParams: assistantMessage.generationParams ?? input.currentGenerationParams(),
      prompt: text,
      referencedImageIds: references,
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
    await saveMessage(toPlainMessage(message)).catch(input.onStorageError);

    const userMessage = [...input.messages.value]
      .reverse()
      .find(
        (item) =>
          item.conversationId === message.conversationId &&
          item.role === "user" &&
          timestampFromCreatedAt(item) <= timestampFromCreatedAt(message),
      );

    if (userMessage) {
      await runImageRequest(
        jobs.createJob({
          assistantMessageId: message.id,
          conversationId: message.conversationId,
          generationParams: message.generationParams ?? input.currentGenerationParams(),
          prompt: userMessage.content,
          referencedImageIds: message.referencedImageIds,
          userMessageId: userMessage.id,
        }),
      );
    }
  }

  async function runImageRequest(job: GenerationJob) {
    try {
      const params = job.generationParams;
      const imageData = job.referencedImageIds.length
        ? await requestImageEdit(job.prompt, job.referencedImageIds, params)
        : await input.imageClient.generate({ prompt: job.prompt, params });
      const now = Date.now();
      const createdAt = isoTimestamp(now);
      const mimeType = `image/${params.outputFormat}`;
      const blob = base64ToBlob(imageData, mimeType);
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
        conversationId: input.conversationExists(job.conversationId)
          ? job.conversationId
          : undefined,
        messageId: hasMessage(job.assistantMessageId)
          ? job.assistantMessageId
          : undefined,
        prompt: job.prompt,
        referencedImageIds: job.referencedImageIds,
        createdAt,
        updatedAt: createdAt,
        previewUrl: createObjectUrl(blob),
      };

      const assistantMessage = findMessage(job.assistantMessageId);
      if (assistantMessage) {
        assistantMessage.status = "success";
        assistantMessage.content = job.referencedImageIds.length
          ? "已基于引用图生成一张图片。"
          : "已生成一张图片。";
        assistantMessage.resultImageIds = [imageId];
        assistantMessage.errorMessage = undefined;
        replaceMessage(assistantMessage);
      }
      input.imageAssets.value = [imageAsset, ...input.imageAssets.value];

      const saveTasks: Promise<unknown>[] = [
        saveImageBlob(blobKey, blob),
        saveImageAsset(toPlainImageAsset(imageAsset)),
      ];
      if (assistantMessage) {
        saveTasks.push(saveMessage(toPlainMessage(assistantMessage)));
      }
      await Promise.all(saveTasks);
      await input.refreshStorageUsage();
      jobs.markJobSuccess(job.id);
    } catch (error) {
      const message = formatError(error);
      const assistantMessage = findMessage(job.assistantMessageId);
      if (assistantMessage) {
        assistantMessage.status = "error";
        assistantMessage.content = `生成失败：${message}`;
        assistantMessage.errorMessage = message;
        assistantMessage.resultImageIds = [];
        replaceMessage(assistantMessage);
        await saveMessage(toPlainMessage(assistantMessage)).catch(input.onStorageError);
      }
      await input.refreshStorageUsage();
      jobs.markJobError(job.id, message);
    }
  }

  async function requestImageEdit(
    prompt: string,
    references: string[],
    params: GenerationParams,
  ) {
    if (references.length > 16) {
      throw new Error("一次最多支持编辑 16 张引用图片。");
    }

    const images = await Promise.all(
      references.map(async (id) => {
        const reference = input.imageById(id);
        if (!reference?.blobKey) {
          throw new Error("引用图片缺少本地文件数据，无法编辑。");
        }

        const blob = await loadImageBlob(reference.blobKey);
        if (!blob) {
          throw new Error("无法读取引用图片文件，请重新生成或导入图片。");
        }

        return {
          blob,
          name: filenameFromAsset(reference),
        };
      }),
    );

    return input.imageClient.edit({
      prompt,
      params,
      images,
    });
  }

  function replaceMessage(message: Message) {
    input.messages.value = input.messages.value.map((item) =>
      item.id === message.id ? { ...message } : item,
    );
  }

  function findMessage(messageId: string) {
    return input.messages.value.find((item) => item.id === messageId);
  }

  function hasMessage(messageId: string) {
    return Boolean(findMessage(messageId));
  }

  return {
    activeConversationPendingJobs: jobs.activeConversationPendingJobs,
    canSend,
    imageModeLabel,
    isGenerating,
    pendingJobCount: jobs.pendingJobCount,
    retryMessage,
    submitMessage,
  };
}

function titleFromPrompt(prompt: string) {
  return prompt.length > 16 ? `${prompt.slice(0, 16)}...` : prompt;
}

function filenameFromAsset(asset: ImageAsset) {
  const extension = asset.mimeType === "image/jpeg"
    ? "jpeg"
    : asset.mimeType === "image/webp"
      ? "webp"
      : "png";

  return `${asset.name || asset.id}.${extension}`;
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
  };
}

function toPlainImageAsset(imageAsset: ImageAsset): ImageAsset {
  return {
    id: imageAsset.id,
    blobKey: imageAsset.blobKey,
    name: imageAsset.name,
    source: imageAsset.source,
    mimeType: imageAsset.mimeType,
    width: imageAsset.width,
    height: imageAsset.height,
    sizeBytes: imageAsset.sizeBytes,
    conversationId: imageAsset.conversationId,
    messageId: imageAsset.messageId,
    prompt: imageAsset.prompt,
    referencedImageIds: imageAsset.referencedImageIds
      ? [...imageAsset.referencedImageIds]
      : undefined,
    createdAt: imageAsset.createdAt,
    updatedAt: imageAsset.updatedAt,
  };
}
