import type { GenerationParams } from "../../types/studio";

export type GenerationJobStatus = "pending" | "success" | "error";

export type GenerationJob = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  prompt: string;
  referencedImageIds: string[];
  editSourceImageId?: string;
  editMaskImageId?: string;
  generationParams: GenerationParams;
  status: GenerationJobStatus;
  startedAtMs: number;
  finishedAtMs?: number;
  errorMessage?: string;
};
