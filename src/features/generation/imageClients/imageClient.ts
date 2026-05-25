import type { GenerationParams } from "../../../types/studio";

export type ImageEditSource = {
  blob: Blob;
  name: string;
};

export type GenerateImageInput = {
  prompt: string;
  params: GenerationParams;
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
