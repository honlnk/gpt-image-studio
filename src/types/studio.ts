export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "success" | "error";
export type ImageSource = "generated" | "imported";

export type Conversation = {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
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
};

export type ImageAsset = {
  id: string;
  name: string;
  source: ImageSource;
  prompt: string;
  createdAt: string;
};

export type EditorKey = "size" | "quality" | "background" | "format";
