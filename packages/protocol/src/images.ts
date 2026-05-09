export type ProtocolGenerationParams = {
  size: "auto" | "1024x1024" | "1536x1024" | "1024x1536" | "custom";
  width: number;
  height: number;
  quality: "auto" | "high" | "medium" | "low";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "webp" | "jpeg";
};

export type ProtocolGenerateImageRequest = {
  prompt: string;
  params: ProtocolGenerationParams;
};

export type ProtocolEditImageRequest = ProtocolGenerateImageRequest & {
  imageBlobKeys: string[];
};

export type ProtocolImageResponse = {
  b64Json: string;
};
