import { storeToRefs } from "pinia";
import { useGenerationStore } from "../../stores/generationStore";
import type { ImageClient } from "./imageClients/imageClient";
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
  activeEditMaskImageId: Ref<string>;
  activeEditSourceImageId: Ref<string>;
  composerText: Ref<string>;
  createConversationRecord: (input: CreateConversationRecordInput) => Promise<Conversation>;
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

export function useStudioGeneration(input: UseStudioGenerationInput) {
  const generation = useGenerationStore();
  const refs = storeToRefs(generation);

  generation.configureGenerationStore(input);

  return {
    ...refs,
    retryMessage: generation.retryMessage,
    submitMessage: generation.submitMessage,
  };
}
