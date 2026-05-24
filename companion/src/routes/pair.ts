import type { FastifyInstance } from "fastify";
import type {
  PairConfirmRequest,
  PairStartResponse,
  PairWaitRequest,
  PairWaitResponse,
  PairConfirmResponse,
  PairUnpairResponse,
} from "../types.js";
import { startPairing, confirmPairing, clearSession, enterPairingMode } from "../pairingState.js";

type PairRoutesOptions = {
  sessionTtlMs: number;
};

export async function pairRoutes(app: FastifyInstance, opts: PairRoutesOptions) {
  app.post<{ Body: PairWaitRequest; Reply: PairWaitResponse }>("/pair/wait", async (req, reply) => {
    if (req.headers.origin) {
      return reply.status(403).send({ error: "配对等待模式只能由本地 CLI 开启" } as never);
    }
    const timeoutSeconds = Math.max(1, Number(req.body?.timeoutSeconds) || 300);
    const result = enterPairingMode(timeoutSeconds * 1000);
    return reply.send(result);
  });

  app.post<{ Reply: PairStartResponse }>("/pair/start", async (_req, reply) => {
    const result = startPairing();
    if (!result) {
      return reply.status(409).send({ error: "请先在终端运行 gpt-image-studio pair" } as never);
    }
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

  app.post<{ Reply: PairUnpairResponse }>("/pair/unpair", async (_req, reply) => {
    clearSession();
    return reply.send({ paired: false });
  });
}
