export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
  runMode: "serve" | "managed";
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

export type PairStartResponse = {
  expiresInSeconds: number;
};

export type PairWaitRequest = {
  timeoutSeconds?: number;
};

export type PairWaitResponse = {
  waiting: true;
  expiresInSeconds: number;
};

export type PairConfirmRequest = {
  pairingCode: string;
};

export type PairConfirmResponse = {
  sessionToken: string;
  expiresAt?: string;
};

export type PairUnpairResponse = {
  paired: false;
};
