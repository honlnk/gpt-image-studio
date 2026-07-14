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

// ---- 凭证管理（Companion 管理面板专用）----

/**
 * provider 预设：下拉选项 + 默认值。
 * 来自 companion 的 GET /credentials/presets，与 CLI provider add 菜单同源
 * （companion/src/providerPresets.ts）。
 */
export type CompanionProviderPreset = {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

/**
 * 单条 provider 配置。GET /credentials 返回明文 apiKey——凭证接口受 loopbackGuard
 * 保护（只接受本机请求），明文回传给本机浏览器是安全的，方便编辑时查看。
 */
export type CompanionCredentialEntry = {
  id: string;
  label: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

/** GET /credentials 的返回：全量列表 + 当前激活 id。 */
export type CompanionCredentialsListResponse = {
  entries: CompanionCredentialEntry[];
  activeId: string | null;
};

/** POST /credentials、PUT /credentials/:id 的请求体。 */
export type CompanionCredentialInput = {
  label?: string;
  provider?: string;
  apiBaseUrl: string;
  apiKey: string;
  model?: string;
};

/** 新增/更新成功后返回的单条配置。 */
export type CompanionCredentialMutationResponse = {
  ok: true;
  entry: CompanionCredentialEntry;
};

export type CompanionCredentialActivateResponse = {
  ok: true;
  activeId: string;
};

export type CompanionCredentialDeleteResponse = {
  ok: true;
};

// ---- 日志查看（Companion 管理面板专用）----

export type CompanionLogsTailResponse = {
  lines: string[];
  logFile: string | null;
  date: string;
};
