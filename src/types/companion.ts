export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
  runMode?: "serve" | "managed";
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

export type PairStartResponse = {
  expiresInSeconds: number;
};

export type PairConfirmResponse = {
  sessionToken: string;
  expiresAt?: string;
};

export type PairUnpairResponse = {
  paired: false;
};
