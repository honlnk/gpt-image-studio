export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "success" | "error";
export type ImageSource = "generated" | "imported";
export type ImageTagColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple";

export type Conversation = {
  id: string;
  title: string;
  summary: string;
  isTitleManuallySet?: boolean;
  createdAt?: string;
  updatedAt: string;
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
  generationParams?: GenerationParams;
  errorMessage?: string;
  editSourceImageId?: string;
  editMaskImageId?: string;
};

export type ImageAsset = {
  id: string;
  blobKey?: string;
  name: string;
  source: ImageSource;
  tagColor?: ImageTagColor;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  conversationId?: string;
  messageId?: string;
  prompt: string;
  revisedPrompt?: string;
  referencedImageIds?: string[];
  editSourceImageId?: string;
  isEditMask?: boolean;
  isTransientMask?: boolean;
  transientBlob?: Blob;
  createdAt: string;
  updatedAt?: string;
  previewUrl?: string;
};

export type SizeRatio = "21:9" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16";
export type SizeResolution = "1k" | "2k" | "4k";

export type GenerationParams = {
  size: "auto" | SizeRatio | "custom";
  resolution: SizeResolution;
  width: number;
  height: number;
  quality: "auto" | "high" | "medium" | "low";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "webp" | "jpeg";
};

export type ConnectionMode = "direct" | "localCompanion";
export type ApiBaseUrlMode = "origin" | "full";

export type PromptRewriteGuardHistoryItem = {
  id: string;
  text: string;
  createdAt: string;
};

export type AppSettings = {
  connectionMode: ConnectionMode;
  apiKey: string;
  apiBaseUrl: string;
  apiBaseUrlMode: ApiBaseUrlMode;
  model: string;
  promptRewriteGuardEnabled: boolean;
  promptRewriteGuardText: string;
  promptRewriteGuardHistory: PromptRewriteGuardHistoryItem[];
  defaults: GenerationParams;
  storageMode: "indexeddb";
};

export type EditorKey = "size" | "background" | "format";

export type ConversationDraft = {
  conversationId: string;
  composerText: string;
  attachedImageIds: string[];
  editModeEnabled: boolean;
  editSourceImageId?: string;
  editMaskImageId?: string;
  generationParams: GenerationParams;
  updatedAtMs: number;
};
