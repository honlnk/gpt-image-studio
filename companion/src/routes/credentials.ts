import type { FastifyInstance, FastifyReply } from "fastify";
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
  CredentialStoreError,
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
type CredentialsRoutesOptions = {
  allowedOrigins?: string[];
};

export async function credentialsRoutes(app: FastifyInstance, opts?: CredentialsRoutesOptions) {
  // plugin 内最先注册守卫：本 plugin 所有路由都受 loopback 约束。
  // allowedOrigins 与 CORS 白名单共享，让受信任的远程站点也能管理凭证。
  await loopbackGuard(app, opts?.allowedOrigins ?? []);

  app.get<{ Reply: ProviderPreset[] }>("/credentials/presets", async () => {
    return PROVIDER_PRESETS;
  });

  app.get<{ Reply: CompanionCredentialsListResponse }>("/credentials", async (_req, reply) => {
    try {
      return listCredentials();
    } catch (error) {
      return handleStoreError(error, reply);
    }
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
    try {
      const entry = addCredential(input);
      return { ok: true, entry };
    } catch (e) {
      return handleStoreError(e, reply);
    }
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
    try {
      const entry = updateCredential(req.params.id, input);
      if (!entry) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true, entry };
    } catch (e) {
      return handleStoreError(e, reply);
    }
  });

  app.delete<{
    Params: { id: string };
    Reply: CompanionCredentialDeleteResponse;
  }>("/credentials/:id", async (req, reply) => {
    try {
      const removed = removeCredential(req.params.id);
      if (!removed) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true };
    } catch (e) {
      return handleStoreError(e, reply);
    }
  });

  app.post<{
    Params: { id: string };
    Reply: CompanionCredentialActivateResponse;
  }>("/credentials/:id/activate", async (req, reply) => {
    try {
      const ok = activateCredential(req.params.id);
      if (!ok) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true, activeId: req.params.id };
    } catch (e) {
      return handleStoreError(e, reply);
    }
  });
}

/**
 * 把 CredentialStoreError 转成 500 + { error, corrupt: true } 响应。
 *
 * 凭据文件损坏时 loadStore 抛 CredentialStoreError（已备份损坏文件并给出可读文案）；
 * 这里只在 route 边界兜底一次，让 Web 端 credError 通道能展示具体原因。
 * 非 CredentialStoreError 重新抛出，交给 Fastify 默认错误处理器。
 *
 * 返回值用 `as never` 绕过 Fastify 的 Reply 类型约束——和现有 400 错误响应的
 * `{ error } as never` 同一模式：错误响应的 shape 不在正常 Reply 类型里。
 */
function handleStoreError(error: unknown, reply: FastifyReply): never {
  if (error instanceof CredentialStoreError) {
    return reply.status(500).send({ error: error.message, corrupt: true }) as never;
  }
  throw error;
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
