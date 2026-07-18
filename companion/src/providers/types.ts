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
  /** 对齐步长。OpenAI=16，GLM=32，豆包=1（无步长约束）。 */
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
 * 分辨率档位（companion 声明、web 渲染）。
 *
 * 每个 provider 直接声明自己支持哪几档——声明什么是 provider 自己的真实能力，
 * 不是「为了不破坏现状而凑出来的值」。web 端不再写死 1K/2K/4K、不再用 maxPixels
 * 运行时过滤（GLM 4K 过滤特判随之删除），改为直接渲染 companion 上报的档位。
 *
 * value 与 web 的 SizeResolution 对齐，但本类型用 string 而非枚举，
 * 以便豆包能声明 web 此前没有的 "3k" 档。
 */
export type ResolutionOption = {
  /** 档位标识，例如 "1k" / "2k" / "3k" / "4k"。 */
  value: string;
  /** 展示文案，例如 "1K" / "2K" / "3K" / "4K"。 */
  label: string;
  /** 该档的目标像素数（width × height 的基准），web 的 dimensionsForRatio 用它算具体尺寸。 */
  targetPixels: number;
};

/**
 * adapter 翻译专用的私有配置，不回流 web。
 *
 * 与 resolutionOptions/sizeConstraints 的区别：那两个字段会通过 /auth/status 回流给 web
 * 供 UI 渲染；本字段只被 companion 内部的 adapter 读取，用于协议翻译。物理隔离确保
 * 翻译细节不泄漏到 web 端。
 *
 * 各字段全部可选，provider 按自己的协议差异按需声明。OpenAI 兼容家族（用 WxH 像素）
 * 通常不需要此字段；Gemini/Grok 这类用枚举值传 size/resolution 的才需要。
 */
export type ProviderAdapterConfig = {
  /**
   * 该 provider 官方支持的 aspect_ratio 枚举（如 Gemini/Grok）。
   * adapter 据此判断 web 发来的比例是否合法——在枚举内则传给上游，否则不传（让上游自选）。
   * 未声明时 adapter 自行处理（如 WxH 家族不认 aspect_ratio，无需此字段）。
   */
  supportedAspectRatios?: readonly string[];
  /**
   * 分辨率档位到上游实际值的映射。
   * key = web 档位 value（如 "1k"），val = 发给上游的值（如 Gemini 的 "1K"）。
   * 未声明时 adapter 直接用 web 档位 value 透传。
   */
  resolutionMap?: Readonly<Record<string, string>>;
  /**
   * 该 provider 官方支持的 resolution 枚举白名单（如 Grok 只有 1k/2k）。
   * 与 resolutionMap 互斥：resolutionMap 带"值映射"，这里只带"合法性校验"。
   * web 发来的档位若不在此列则不传给上游。
   */
  supportedResolutions?: readonly string[];
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
  /** Companion 能力协议中的分辨率档位，例如 "1k" / "2k" / "4k"。 */
  resolution?: string;
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
 * `{ data: [{ b64_json, revised_prompt, mime_type }] }` 返回给 web。
 *
 * mimeType 是图片字节的真实格式（来自厂商响应字段、URL 下载的 Content-Type，
 * 或对 base64 的 magic bytes 嗅探），web 据此给 ImageAsset.mimeType 赋值，
 * 避免标签与字节不符。未探测到时为 undefined，web 回退到 outputFormat 猜测。
 */
export type OpenAIImageResult = {
  b64Json: string;
  revisedPrompt?: string;
  mimeType?: string;
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
 * - resolutionOptions 声明该 provider 支持的分辨率档位（companion 声明、web 渲染）。
 *   web 删除写死档位 + maxPixels 运行时过滤后，直接渲染本字段。
 * - getSizeConstraints/getResolutionOptions 可选：用于 Wan 这类能力会随 model
 *   变化的 provider。未提供时使用静态字段。
 */
export type ProviderAdapter = {
  readonly id: string;
  readonly capability: ProviderCapability;
  readonly sizeConstraints: SizeConstraints;
  /** 该 provider 支持的分辨率档位，companion 声明、web 渲染。 */
  readonly resolutionOptions: readonly ResolutionOption[];
  getSizeConstraints?(config: ProviderConfig): SizeConstraints;
  getResolutionOptions?(config: ProviderConfig): readonly ResolutionOption[];

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
