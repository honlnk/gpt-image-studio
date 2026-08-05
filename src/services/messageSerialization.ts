import type { ImageAsset, Message } from "../types/studio";
import { clonePromptWordbanks } from "./promptWordbanks";

/**
 * Message / ImageAsset 的深拷贝序列化。
 *
 * 从内存里的响应式对象剥离运行时字段（如 previewUrl），生成可安全持久化到
 * IndexedDB 的纯数据对象。历史内联在 generationStore.ts，抽出后 store 只管状态。
 */

/** 深拷贝 Message，断开与内存响应式对象的引用。 */
export function toPlainMessage(message: Message): Message {
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

/** 深拷贝 ImageAsset，剥离 previewUrl 等运行时字段。 */
export function toPlainImageAsset(imageAsset: ImageAsset): ImageAsset {
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
