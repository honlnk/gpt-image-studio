export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
  runMode?: "serve" | "managed";
};

export type CompanionAuthStatus = {
  provider: string;
  mode: "api_key";
  ready: boolean;
  accountLabel: string;
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
