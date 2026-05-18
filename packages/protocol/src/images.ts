export type ProtocolGenerationParams = {
  size:
    | "auto"
    | "21:9"
    | "16:9"
    | "3:2"
    | "4:3"
    | "1:1"
    | "3:4"
    | "2:3"
    | "9:16"
    | "custom";
  resolution: "1k" | "2k" | "4k";
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
