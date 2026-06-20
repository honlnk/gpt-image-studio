/**
 * Provider 翻译层的类型契约。
 *
 * companion 对外始终暴露 OpenAI Images API 形状（routes/images.ts 收到的请求、
 * 返回给 web 的响应都是 OpenAI 形状）。每个 provider adapter 内部负责
 * 「OpenAI 形状 → 厂商形状 → fetch → 厂商响应 → OpenAI 形状」的全过程。
 *
 * 详见 docs/companion-providers-plan.md「ProviderAdapter 接口」一节。
 */

/** 背景取值，与 OpenAI Images API 的 background 参数对齐。 */
export type BackgroundValue = "auto" | "opaque" | "transparent";

/** 输出格式，与 OpenAI Images API 的 output_format 参数对齐。 */
export type OutputFormatValue = "png" | "webp" | "jpeg";

/**
 * Provider 能力声明。companion 通过 /auth/status 把它回流给 web，
 * web 据此决定参数栏里哪些 tag / 选项可见（capability-driven UI）。
 * capability 只描述「能不能」，不描述「怎么翻译」——后者在 adapter 内部。
 */
export type ProviderCapability = {
  /** 该 provider 是否支持文生图。当前所有 provider 都为 true，保留字段以备未来。 */
  generate: true;
  /** 该 provider 是否支持图片编辑（无 mask 的全图编辑）。 */
  edit: boolean;
  /** 编辑是否支持 mask 局部重绘。mask=true 蕴含 edit=true。 */
  mask: boolean;
  /** 支持的背景值列表。 */
  backgrounds: BackgroundValue[];
  /** 支持的输出格式列表。 */
  outputFormats: OutputFormatValue[];
};

/**
 * 尺寸软约束。每个 provider 把自己的硬规则声明在这里。
 * web 端 dimensionsForRatio / getCustomSizeError 等通用逻辑原本读的是硬编码常量，
 * 现在改读 companion 上报的本字段——逻辑不动，只换数据源。
 *
 * 注意：这些是「合法尺寸的边界」，不是「OpenAI 的 1024x1024 枚举」。
 * 满足边界的任意尺寸都允许透传，由 provider 自己决定如何规整。
 */
export type SizeConstraints = {
  /** 对齐步长。OpenAI=16，GLM=32。 */
  step: number;
  /** 单边最小像素。 */
  min: number;
  /** 单边最大像素。 */
  max: number;
  /** 总像素上限。 */
  maxPixels: number;
  /** 总像素下限（OpenAI=655360，GLM 等无下限概念时置 0）。 */
  minPixels: number;
  /** 长边/短边比例上限。null = 不限制。 */
  maxAspectRatio: number | null;
  /** auto / 缺省 size 映射到的具体尺寸，例如 "1024x1024"。 */
  defaultSize: string;
};

/**
 * OpenAI 形状的文生图请求。adapter.generate 的入参。
 * 来自 web 的请求体（route 层已做 HTTP 边界校验）。
 *
 * `known` 字段是跨 provider 共享的标准字段（所有 provider 都能理解）。
 * `extra` 是 web 发出的其余字段（quality / stream / partial_images 等），
 * 透传型 adapter（openai）应原样带上以保持行为不变；
 * 翻译型 adapter（glm）按需取用，未识别的字段可丢弃。
 */
export type OpenAIImageRequest = {
  model: string;
  prompt: string;
  /** OpenAI 形状的 size，例如 "1024x1024" / "auto"。 */
  size: string;
  background: string;
  outputFormat: string;
  /** web 请求体中上述已知字段之外的所有字段，原样保留。 */
  extra: Record<string, unknown>;
};

/**
 * 一张待编辑图片的 OpenAI 形状表示（multipart 解析后）。
 * blob 是原始字节，adapter 自行决定如何转发给上游。
 */
export type EditImage = {
  blob: Buffer;
  name: string;
  mimeType: string;
};

/** OpenAI 形状的编辑请求。adapter.edit 的入参。 */
export type OpenAIImageEditRequest = OpenAIImageRequest & {
  images: EditImage[];
  mask?: EditImage;
  /**
   * 编辑请求里 web 额外带的文本字段（stream / partial_images 等）。
   * 透传型 adapter 应作为 form 字段原样带上；翻译型 adapter 按需取用。
   * 注意：images/mask 不在这里，单独以结构化字段传递。
   */
  editExtra: Record<string, string>;
};

/**
 * adapter 统一的输出形状。routes/images.ts 会把它再包成
 * `{ data: [{ b64_json, revised_prompt }] }` 返回给 web。
 */
export type OpenAIImageResult = {
  b64Json: string;
  revisedPrompt?: string;
};

/**
 * companion 凭据 + provider 配置（adapter 需要的连接信息）。
 * 来自 credentials.json，registry 据此解析 adapter。
 */
export type ProviderConfig = {
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  /** provider 专属 model id（login 时填，不写死在 adapter）。 */
  model?: string;
};

/**
 * Provider adapter 接口。输入输出都是 OpenAI 形状。
 *
 * - describe() 返回给人看的展示信息（/auth/status 的 accountLabel 等）。
 * - generate() 文生图，所有 provider 必须实现。
 * - edit() 图片编辑，可选；未实现时 capability.edit 应为 false，
 *   route 层据此返回 501。
 */
export type ProviderAdapter = {
  readonly id: string;
  readonly capability: ProviderCapability;
  readonly sizeConstraints: SizeConstraints;

  describe(config: ProviderConfig): { label: string; providerId: string };

  generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult>;

  edit?(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult>;
};
