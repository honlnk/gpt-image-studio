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
export type ApiMode = "images" | "responses";
export type AnalyticsEventSource = "ui_click" | "ui_input" | "system";
export type AnalyticsPromptCapture = "none" | "length_only" | "masked" | "raw";

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
  generationStartedAt?: string;
  generationParams?: GenerationParams;
  promptRequestSettings?: PromptRequestSettings;
  networkRetryAttempt?: number;
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
  generationDurationMs?: number;
  isEditMask?: boolean;
  isTransientMask?: boolean;
  transientBlob?: Blob;
  createdAt: string;
  updatedAt?: string;
  previewUrl?: string;
};

export type SizeRatio = "21:9" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16";
/**
 * 分辨率档位。放开为 string 而非枚举，以便接收 companion 回流的任意档位
 * （如豆包的 "3k"，web 此前没有）。持久化/URL 里仍是 "1k"/"2k"/"4k" 这些值。
 */
export type SizeResolution = string;

export type GenerationParams = {
  size: "auto" | SizeRatio | "custom";
  resolution: SizeResolution;
  width: number;
  height: number;
  imageCount: number;
  quality: "auto" | "high" | "medium" | "low";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "webp" | "jpeg";
};

export type ConnectionMode = "direct" | "localCompanion";
export type ApiBaseUrlMode = "origin" | "full";
export type PromptMode = "default" | "safe" | "creative" | "adult";
export type PromptWordbankSectionKey =
  | "pose.safe"
  | "pose.creative"
  | "pose.nsfw"
  | "adultInspiration";

export type PromptWordbanks = {
  pose: {
    safe: string[];
    creative: string[];
    nsfw: string[];
  };
  adultInspiration: string[];
};

export type PromptRewriteGuardHistoryItem = {
  id: string;
  text: string;
  createdAt: string;
};

export type FavoritePrompt = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptRequestSettings = {
  promptMode: PromptMode;
  promptWordbanks: PromptWordbanks;
  promptRewriteGuardEnabled: boolean;
  promptRewriteGuardText: string;
};

export type AppSettings = {
  connectionMode: ConnectionMode;
  apiKey: string;
  apiBaseUrl: string;
  apiBaseUrlMode: ApiBaseUrlMode;
  apiMode: ApiMode;
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
  model: string;
  promptMode: PromptMode;
  promptWordbanks: PromptWordbanks;
  promptRewriteGuardEnabled: boolean;
  promptRewriteGuardText: string;
  promptRewriteGuardHistory: PromptRewriteGuardHistoryItem[];
  favoritePrompts: FavoritePrompt[];
  autoRetryOnNetworkError: boolean;
  analyticsEnabled: boolean;
  analyticsPromptCapture: AnalyticsPromptCapture;
  defaults: GenerationParams;
  storageMode: "indexeddb";
};

export type EditorKey = "size" | "count" | "background" | "format";

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

export type AnalyticsEvent = {
  id: string;
  eventName: string;
  occurredAt: string;
  sessionId: string;
  conversationId?: string;
  messageId?: string;
  imageId?: string;
  source: AnalyticsEventSource;
  payload?: Record<string, unknown>;
};
