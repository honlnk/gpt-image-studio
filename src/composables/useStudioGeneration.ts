import { computed } from "vue";
import { saveImageAsset, saveImageBlob, loadImageBlob } from "../services/imageAssets";
import { base64ToBlob, editImage, generateImage } from "../services/imagesApi";
import { readImageDimensions } from "../services/imageMetadata";
import { saveMessage } from "../services/messages";
import { createObjectUrl } from "../services/objectUrls";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
} from "../types/studio";
import type { ComputedRef, Ref } from "vue";

type CreateConversationRecordInput = {
  title: string;
  summary: string;
  updatedAtMs: number;
};

type UseStudioGenerationInput = {
  activeConversation: ComputedRef<Conversation | undefined>;
  apiBaseUrl: Ref<string>;
  apiKey: Ref<string>;
  attachedImages: Ref<string[]>;
  composerText: Ref<string>;
  createConversationRecord: (input: CreateConversationRecordInput) => Promise<Conversation>;
  currentGenerationParams: () => GenerationParams;
  customSizeError: ComputedRef<string>;
  imageAssets: Ref<ImageAsset[]>;
  imageById: (id: string) => ImageAsset | undefined;
  messages: Ref<Message[]>;
  model: Ref<string>;
  onStorageError: (error: unknown) => void;
  persistConversation: (conversation: Conversation) => Promise<void>;
  refreshStorageUsage: () => Promise<void>;
  updateConversationSummary: (
    conversationId: string,
    text: string,
    summary: string,
    updatedAtMs?: number,
  ) => Conversation | null;
};

export function useStudioGeneration(input: UseStudioGenerationInput) {
  const isGenerating = computed(() =>
    input.messages.value.some((message) => message.status === "pending"),
  );
  const imageModeLabel = computed(() =>
    input.attachedImages.value.length ? "引用图片编辑" : "文字生成图片",
  );
  const canSend = computed(() =>
    !isGenerating.value &&
    !input.customSizeError.value &&
    Boolean(input.composerText.value.trim() || input.attachedImages.value.length),
  );

  async function submitMessage() {
    if (!canSend.value || isGenerating.value) return;

    const now = Date.now();
    const text = input.composerText.value.trim() || "基于引用图片继续编辑。";
    const conversation =
      input.activeConversation.value ??
      await input.createConversationRecord({
        title: titleFromPrompt(text),
        summary: imageModeLabel.value,
        updatedAtMs: now,
      });
    const conversationId = conversation.id;
    const references = [...input.attachedImages.value];
    const userMessage: Message = {
      id: `m-${now}`,
      conversationId,
      role: "user",
      content: text,
      referencedImageIds: references,
      resultImageIds: [],
      status: "success",
      createdAt: "刚刚",
      createdAtMs: now,
      generationParams: input.currentGenerationParams(),
    };
    const assistantMessage: Message = {
      id: `m-${now + 1}`,
      conversationId,
      role: "assistant",
      content: references.length
        ? "正在基于引用图片生成编辑结果。"
        : "正在生成图片。",
      referencedImageIds: references,
      resultImageIds: [],
      status: "pending",
      createdAt: "刚刚",
      createdAtMs: now + 1,
      generationParams: input.currentGenerationParams(),
    };

    input.messages.value.push(userMessage, assistantMessage);
    const updatedConversation = input.updateConversationSummary(
      conversationId,
      text,
      imageModeLabel.value,
      now,
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

    await runImageRequest(text, references, assistantMessage);
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
          (item.createdAtMs ?? 0) <= (message.createdAtMs ?? 0),
      );

    if (userMessage) {
      await runImageRequest(
        userMessage.content,
        message.referencedImageIds,
        message,
      );
    }
  }

  async function runImageRequest(
    prompt: string,
    references: string[],
    assistantMessage: Message,
  ) {
    try {
      if (!input.apiKey.value.trim()) {
        throw new Error("请先在设置里填写 OpenAI API key。");
      }

      if (!input.apiBaseUrl.value.trim()) {
        throw new Error("请先在设置里填写 API Base URL。");
      }

      const params = assistantMessage.generationParams ?? input.currentGenerationParams();
      const imageData = references.length
        ? await requestImageEdit(prompt, references, params)
        : await generateImage({
            apiBaseUrl: input.apiBaseUrl.value,
            apiKey: input.apiKey.value,
            model: input.model.value,
            prompt,
            params,
          });
      const now = Date.now();
      const mimeType = `image/${params.outputFormat}`;
      const blob = base64ToBlob(imageData, mimeType);
      const dimensions = await readImageDimensions(blob);
      const imageId = `img-${now}`;
      const blobKey = `blob-${now}`;
      const imageAsset: ImageAsset = {
        id: imageId,
        blobKey,
        name: titleFromPrompt(prompt),
        source: "generated",
        mimeType,
        width: dimensions?.width,
        height: dimensions?.height,
        sizeBytes: blob.size,
        conversationId: assistantMessage.conversationId,
        messageId: assistantMessage.id,
        prompt,
        referencedImageIds: references,
        createdAt: "刚刚",
        updatedAt: "刚刚",
        createdAtMs: now,
        previewUrl: createObjectUrl(blob),
      };

      assistantMessage.status = "success";
      assistantMessage.content = references.length
        ? "已基于引用图生成一张图片。"
        : "已生成一张图片。";
      assistantMessage.resultImageIds = [imageId];
      assistantMessage.errorMessage = undefined;
      input.imageAssets.value = [imageAsset, ...input.imageAssets.value];
      replaceMessage(assistantMessage);

      await Promise.all([
        saveImageBlob(blobKey, blob),
        saveImageAsset(toPlainImageAsset(imageAsset)),
        saveMessage(toPlainMessage(assistantMessage)),
      ]);
      await input.refreshStorageUsage();
    } catch (error) {
      const message = formatError(error);
      assistantMessage.status = "error";
      assistantMessage.content = `生成失败：${message}`;
      assistantMessage.errorMessage = message;
      assistantMessage.resultImageIds = [];
      replaceMessage(assistantMessage);
      await saveMessage(toPlainMessage(assistantMessage)).catch(input.onStorageError);
      await input.refreshStorageUsage();
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

    return editImage({
      apiBaseUrl: input.apiBaseUrl.value,
      apiKey: input.apiKey.value,
      model: input.model.value,
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

  return {
    canSend,
    imageModeLabel,
    isGenerating,
    retryMessage,
    submitMessage,
  };
}

function formatError(error: unknown) {
  if (error instanceof SyntaxError) {
    return "图片接口返回了无法解析的响应。";
  }

  return error instanceof Error ? error.message : String(error);
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
    createdAtMs: message.createdAtMs,
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
    createdAtMs: imageAsset.createdAtMs,
  };
}
