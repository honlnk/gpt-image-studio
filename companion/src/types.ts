export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
};

export type CompanionAuthStatus = {
  provider: string;
  mode: "api_key";
  ready: boolean;
  accountLabel: string;
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
