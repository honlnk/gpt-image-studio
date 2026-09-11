/**
 * imagesApi 内部共享的响应/事件类型。
 *
 * 抽出到独立文件，避免 streaming / responses / client 三者互相 import 类型
 * 产生分层倒置（类型 import 虽不产生运行时循环，但语义上要保持单向依赖）。
 */

/** 部分图片（流式预览）回调事件。 */
export type PartialImageEvent = {
  b64Json: string;
  partialImageIndex?: number;
};

/** Images API 标准响应（generations / edits）。 */
export type ImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    /** 部分中转站无视 response_format=b64_json，只返回有时效的图片链接；直连模式在浏览器内下载转换。 */
    url?: string;
    revised_prompt?: string;
  }>;
  error?: {
    message?: string;
  };
};

/** Responses API 单个 output 项。 */
export type ResponsesOutputItem = {
  type?: string;
  result?: unknown;
  revised_prompt?: string;
};

/** Responses API 完整响应。 */
export type ResponsesApiResponse = {
  output?: ResponsesOutputItem[];
  error?: {
    message?: string;
  };
};

/** 流式响应里 image_generation.completed 事件的载荷。 */
export type StreamCompletedImageItem = {
  b64_json?: string;
  /** 部分中转的 completed 事件只带链接不带 base64。 */
  url?: string;
  revised_prompt?: string;
};

/** 统一图片结果（无论 Images API 还是 Responses API）。 */
export type ImageApiResult = {
  b64Json: string;
  revisedPrompt?: string;
  /**
   * 图片字节的真实 MIME。b64_json 路径不提供（回退 outputFormat 猜测）；
   * URL 下载路径由 magic bytes 嗅探提供，generationStore 据此赋值 ImageAsset.mimeType。
   */
  mimeType?: string;
};
