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
  onPartialImage?: (event: PartialImageEvent) => void;
  onStatusText?: (text: string) => void;
};

export type EditImageInput = GenerateImageInput & {
  images: ImageEditSource[];
  mask?: ImageEditSource;
};

export type ImageClientResult = {
  b64Json: string;
  revisedPrompt?: string;
  /**
   * 图片字节的真实 MIME（companion 回流，来自厂商响应或 magic bytes 嗅探）。
   * direct 模式不提供，为 undefined。generationStore 据此给 ImageAsset.mimeType 赋值，
   * 优先于 outputFormat 猜测。
   */
  mimeType?: string;
};

export type PartialImageEvent = {
  b64Json: string;
  partialImageIndex?: number;
};

export type ImageClient = {
  generate(input: GenerateImageInput): Promise<ImageClientResult>;
  edit(input: EditImageInput): Promise<ImageClientResult>;
};
