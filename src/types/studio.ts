export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "success" | "error";
export type ImageSource = "generated" | "imported";

export type Conversation = {
  id: string;
  title: string;
  summary: string;
  createdAt?: string;
  updatedAt: string;
  updatedAtMs?: number;
  archivedAt?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  referencedImageIds: string[];
  resultImageIds: string[];
  status: MessageStatus;
  createdAt: string;
  createdAtMs?: number;
  generationParams?: GenerationParams;
  errorMessage?: string;
};

export type ImageAsset = {
  id: string;
  blobKey?: string;
  name: string;
  source: ImageSource;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  conversationId?: string;
  messageId?: string;
  prompt: string;
  referencedImageIds?: string[];
  createdAt: string;
  updatedAt?: string;
  createdAtMs?: number;
  previewUrl?: string;
};

export type GenerationParams = {
  size: "auto" | "1024x1024" | "1536x1024" | "1024x1536" | "custom";
  width: number;
  height: number;
  quality: "auto" | "high" | "medium" | "low";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "webp" | "jpeg";
};

export type AppSettings = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  defaults: GenerationParams;
  storageMode: "indexeddb";
};

export type EditorKey = "size" | "quality" | "background" | "format";
