import { storeToRefs } from "pinia";
import { useGenerationStore } from "../../stores/generationStore";
import {
  createImageAssetServices,
  type ImageAssetServices,
} from "../../services/imageAssets";
import {
  createMessageServices,
  type MessageServices,
} from "../../services/messages";
import { resolveStorage } from "../../services/storage/resolveStorage";
import type { ImageClient } from "./imageClients/imageClient";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
  PromptRequestSettings,
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
  activeEditMaskImageId: Ref<string>;
  activeEditSourceImageId: Ref<string>;
  composerText: Ref<string>;
  createConversationRecord: (input: CreateConversationRecordInput) => Promise<Conversation>;
  currentGenerationParams: () => GenerationParams;
  currentPromptRequestSettings: () => PromptRequestSettings;
  customSizeError: ComputedRef<string>;
  imageAssets: Ref<ImageAsset[]>;
  imageById: (id: string) => ImageAsset | undefined;
  imageClient: ImageClient;
  messages: Ref<Message[]>;
  /** 当前 provider 是否支持图生图（带参考图编辑）。 */
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
  /** 阶段一 PR2：存储服务注入。可选——未传时用默认实例。PR4 在 ViewModel 统一注入。 */
  services?: {
    imageAssets: ImageAssetServices;
    messages: MessageServices;
  };
};

// 模块级默认 service 实例，供未显式注入时使用（PR4 后 ViewModel 统一注入）。
const defaultStorage = resolveStorage();
const defaultServices = {
  imageAssets: createImageAssetServices(defaultStorage),
  messages: createMessageServices(defaultStorage),
};

export function useStudioGeneration(input: UseStudioGenerationInput) {
  const generation = useGenerationStore();
  const refs = storeToRefs(generation);

  generation.configureGenerationStore({
    ...input,
    services: input.services ?? defaultServices,
  });

  return {
    ...refs,
    generateAnother: generation.generateAnother,
    refreshGeneratedImage: generation.refreshGeneratedImage,
    retryMessage: generation.retryMessage,
    submitMessage: generation.submitMessage,
  };
}
