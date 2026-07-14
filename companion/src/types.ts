export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
};

export type CompanionAuthStatus = {
  provider: string;
  mode: "api_key";
  ready: boolean;
  accountLabel: string;
  /** 当前 provider 使用的 model id（login 时填，无则空串）。 */
  model: string;
  /** provider 能力声明，web 据此决定参数栏哪些选项可见。 */
  capability: {
    generate: true;
    edit: boolean;
    mask: boolean;
    backgrounds: ("auto" | "opaque" | "transparent")[];
    outputFormats: ("png" | "webp" | "jpeg")[];
  };
  /** provider 的尺寸软约束，web 据此生成合法尺寸选项。 */
  sizeConstraints: {
    step: number;
    min: number;
    max: number;
    maxPixels: number;
    minPixels: number;
    maxAspectRatio: number | null;
    defaultSize: string;
  };
  /**
   * provider 支持的分辨率档位（companion 声明、web 渲染）。
   * web 不再写死 1K/2K/4K、不再用 maxPixels 运行时过滤，直接渲染本字段。
   */
  resolutionOptions: readonly {
    value: string;
    label: string;
    targetPixels: number;
  }[];
};

// ---- 凭证管理（Web 面板专用）----

/**
 * 单条 provider 配置。GET /credentials 返回明文 apiKey——凭证接口受 loopbackGuard
 * 保护（只接受本机请求），明文回传给本机浏览器是安全的，方便用户编辑时查看。
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

// ---- 日志查看（Web 面板专用）----

export type CompanionLogsTailResponse = {
  lines: string[];
  logFile: string | null;
  date: string;
};
