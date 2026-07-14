import type { FastifyInstance } from "fastify";
import type {
  CompanionCredentialsListResponse,
  CompanionCredentialInput,
  CompanionCredentialMutationResponse,
  CompanionCredentialActivateResponse,
  CompanionCredentialDeleteResponse,
} from "../types.js";
import type { ProviderPreset } from "../providerPresets.js";
import { PROVIDER_PRESETS } from "../providerPresets.js";
import { loopbackGuard } from "../middleware/loopback.js";
import {
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
  activateCredential,
} from "../credentials.js";

/**
 * 凭证管理路由（Web 面板 + CLI 共用）：多配置 CRUD + 激活切换。
 *
 * 鉴权：用 loopbackGuard（onRequest）而非连接密钥——
 * 因为凭证管理发生在连接之前（首次需要先填 key 才有意义连接）。
 * loopbackGuard 保证只有本机浏览器/CLI 能写凭证，等同旧 CLI login 的信任模型。
 *
 * 注册顺序注意（见 server.ts）：本 plugin 必须在 authMiddleware 之前注册，
 * 否则 /credentials/* 会被 bearer token 守卫拦成 401。
 *
 * GET /credentials 返回明文 apiKey——loopback 边界下只本机能拿，方便编辑时查看。
 */
export async function credentialsRoutes(app: FastifyInstance) {
  // plugin 内最先注册守卫：本 plugin 所有路由都受 loopback 约束。
  await loopbackGuard(app);

  app.get<{ Reply: ProviderPreset[] }>("/credentials/presets", async () => {
    return PROVIDER_PRESETS;
  });

  app.get<{ Reply: CompanionCredentialsListResponse }>("/credentials", async () => {
    return listCredentials();
  });

  app.post<{
    Body: CompanionCredentialInput;
    Reply: CompanionCredentialMutationResponse;
  }>("/credentials", async (req, reply) => {
    const input = parseInput(req.body);
    const error = validateInput(input);
    if (error) {
      return reply.status(400).send({ error } as never);
    }
    const entry = addCredential(input);
    return { ok: true, entry };
  });

  app.put<{
    Params: { id: string };
    Body: CompanionCredentialInput;
    Reply: CompanionCredentialMutationResponse;
  }>("/credentials/:id", async (req, reply) => {
    const input = parseInput(req.body);
    const error = validateInput(input);
    if (error) {
      return reply.status(400).send({ error } as never);
    }
    const entry = updateCredential(req.params.id, input);
    if (!entry) {
      return reply.status(404).send({ error: "凭据不存在" } as never);
    }
    return { ok: true, entry };
  });

  app.delete<{
    Params: { id: string };
    Reply: CompanionCredentialDeleteResponse;
  }>("/credentials/:id", async (req, reply) => {
    const removed = removeCredential(req.params.id);
    if (!removed) {
      return reply.status(404).send({ error: "凭据不存在" } as never);
    }
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Reply: CompanionCredentialActivateResponse;
  }>("/credentials/:id/activate", async (req, reply) => {
    const ok = activateCredential(req.params.id);
    if (!ok) {
      return reply.status(404).send({ error: "凭据不存在" } as never);
    }
    return { ok: true, activeId: req.params.id };
  });
}

function parseInput(body: unknown): CompanionCredentialInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    label: typeof b.label === "string" ? b.label : undefined,
    provider: typeof b.provider === "string" ? b.provider : undefined,
    apiBaseUrl: typeof b.apiBaseUrl === "string" ? b.apiBaseUrl : "",
    apiKey: typeof b.apiKey === "string" ? b.apiKey : "",
    model: typeof b.model === "string" ? b.model : undefined,
  };
}

function validateInput(input: CompanionCredentialInput): string | null {
  if (!input.apiBaseUrl.trim()) return "apiBaseUrl 不能为空";
  if (!input.apiKey.trim()) return "apiKey 不能为空";
  return null;
}
