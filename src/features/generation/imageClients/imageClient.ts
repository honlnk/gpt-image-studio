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
};

export type ImageClient = {
  generate(input: GenerateImageInput): Promise<string>;
  edit(input: EditImageInput): Promise<string>;
};
