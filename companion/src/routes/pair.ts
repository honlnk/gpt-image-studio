import type { FastifyInstance } from "fastify";
import type { PairConfirmRequest, PairStartResponse, PairConfirmResponse } from "../types.js";
import { startPairing, confirmPairing } from "../pairingState.js";

type PairRoutesOptions = {
  sessionTtlMs: number;
};

export async function pairRoutes(app: FastifyInstance, opts: PairRoutesOptions) {
  app.post<{ Reply: PairStartResponse }>("/pair/start", async (_req, reply) => {
    const result = startPairing();
    return reply.send(result);
  });

  app.post<{ Body: PairConfirmRequest; Reply: PairConfirmResponse }>(
    "/pair/confirm",
    async (req, reply) => {
      const { pairingCode } = req.body as PairConfirmRequest;
      const result = confirmPairing(pairingCode, opts.sessionTtlMs);
      if (!result) {
        return reply.status(401).send({ error: "配对码无效或已过期" } as never);
      }
      return reply.send(result);
    },
  );
}
