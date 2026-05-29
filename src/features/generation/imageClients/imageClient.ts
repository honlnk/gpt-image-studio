import type {
  GenerationParams,
  PromptRequestSettings,
} from "../../../types/studio";

export type ImageEditSource = {
  blob: Blob;
  name: string;
};

export type GenerateImageInput = {
  prompt: string;
  params: GenerationParams;
  promptRequestSettings: PromptRequestSettings;
  onNetworkRetry?: (retryAttempt: number) => void;
};

export type EditImageInput = GenerateImageInput & {
  images: ImageEditSource[];
  mask?: ImageEditSource;
};

export type ImageClientResult = {
  b64Json: string;
  revisedPrompt?: string;
};

export type ImageClient = {
  generate(input: GenerateImageInput): Promise<ImageClientResult>;
  edit(input: EditImageInput): Promise<ImageClientResult>;
};
