export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
};

export type PairStartResponse = {
  pairingCode: string;
  expiresInSeconds: number;
};

export type PairConfirmResponse = {
  sessionToken: string;
  expiresAt?: string;
};
