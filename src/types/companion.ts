export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
};

export type CompanionProviderCapability = {
  generate: true;
  edit: boolean;
  mask: boolean;
  backgrounds: ("auto" | "opaque" | "transparent")[];
  outputFormats: ("png" | "webp" | "jpeg")[];
};

export type CompanionSizeConstraints = {
  step: number;
  min: number;
  max: number;
  maxPixels: number;
  minPixels: number;
  maxAspectRatio: number | null;
  defaultSize: string;
};

/**
 * 分辨率档位（companion 声明、web 渲染）。
 * value 用 string 而非枚举，以便接收 web 此前没有的档位（如豆包的 "3k"）。
 */
export type CompanionResolutionOption = {
  value: string;
  label: string;
  targetPixels: number;
};

export type CompanionAuthStatus = {
  provider: string;
  mode: "api_key";
  ready: boolean;
  accountLabel: string;
  /** 当前 provider 使用的 model id（companion login 时填，无则空串）。 */
  model: string;
  /** provider 能力声明，web 据此决定参数栏哪些选项可见。 */
  capability: CompanionProviderCapability;
  /** provider 的尺寸软约束，web 据此生成合法尺寸选项。 */
  sizeConstraints: CompanionSizeConstraints;
  /**
   * provider 支持的分辨率档位（companion 声明、web 渲染）。
   * web 不再写死 1K/2K/4K、不再用 maxPixels 运行时过滤，直接渲染本字段。
   */
  resolutionOptions: CompanionResolutionOption[];
};

export type CompanionAuthStatusResult =
  | {
      ok: true;
      status: CompanionAuthStatus;
    }
  | {
      ok: false;
      invalidToken: boolean;
    };

// ---- Web ↔ Companion 已知字段镜像（软共享）----
//
// 这份常量与 companion/src/shared/knownFields.ts 是一份手工镜像。
// 没有让 Web 直接 import companion 包，是为了避免引入对 companion 构建
// 产物的依赖（companion 走 tsc + NodeNext，Web 走 Vite）。
//
// 由 src/types/companionKnownFields.contract.test.ts 在 CI 阶段断言
// 两份常量的字段集合完全一致——漂移会直接让测试失败，不再无声失效。
// 新增字段时两端必须同步修改。详见
// docs/companion-provider-adapter-review.md P1 第 5 项。

/** 文生图（POST /images/generations）请求体里的已知字段名集合。 */
export const COMPANION_GENERATE_FIELDS = [
  "model",
  "prompt",
  "size",
  "companion_resolution",
  "background",
  "output_format",
] as const;

/** 图片编辑（POST /images/edits）请求里允许的已知文本字段名集合。 */
export const COMPANION_EDIT_FIELDS = [
  "model",
  "prompt",
  "size",
  "companion_resolution",
  "background",
  "output_format",
] as const;

export type CompanionGenerateField = (typeof COMPANION_GENERATE_FIELDS)[number];
export type CompanionEditField = (typeof COMPANION_EDIT_FIELDS)[number];
