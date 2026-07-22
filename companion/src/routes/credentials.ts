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
  consumeCorruptionEvent,
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
  activateCredential,
  resetEmptyStore,
  restoreLatestBackup,
} from "../credentials.js";
import { isRegisteredProvider, listProviderIds } from "../providers/registry.js";

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
      const store = listCredentials();
      // store 正常加载后，检查是否有未消费的损坏事件。
      // 场景：Web 端连续发多次 /credentials，第一次触发损坏备份，后续请求文件已不在，
      // 返正常空列表——若不检查事件，credError 会被后续 200 清空，用户看不到损坏提示。
      // 事件在 addCredential 成功后清除（语义：用户已重新配置，损坏翻篇）。
      const event = consumeCorruptionEvent();
      if (event) {
        // 复用 handleStoreError 的 reply 发送逻辑（返 never，绕过 Reply 类型约束）
        reply.status(500);
        return { error: event.message, corrupt: true } as never;
      }
      return store;
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

  /**
   * 重置成空配置：写合法空 store + 清除损坏事件。
   * 用户看到凭据损坏提示后选择「重置成空配置」时调用——放弃损坏历史，回到首次使用状态。
   */
  app.post("/credentials/reset-empty", async (_req, reply) => {
    try {
      resetEmptyStore();
      return { ok: true };
    } catch (e) {
      return handleStoreError(e, reply);
    }
  });

  /**
   * 从最近备份恢复：找最新的 credentials.json.corrupt-{ts}.json 尝试恢复。
   * 成功 → 覆盖 credentials.json + 清除事件 + 删掉已恢复的备份。
   * 失败（备份也坏了）→ 抛 CredentialStoreError，原状不变，用户可改试 reset-empty。
   */
  app.post("/credentials/restore-backup", async (_req, reply) => {
    try {
      const store = restoreLatestBackup();
      return { ok: true, entries: store.entries.length, activeId: store.activeId };
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
  // 明确传了 provider 但不在注册表里 → 拒绝（拼写错 / 已删除的 provider 不能静默存下来）
  if (
    input.provider !== undefined &&
    input.provider.trim() !== "" &&
    !isRegisteredProvider(input.provider.trim())
  ) {
    const valid = listProviderIds().sort().join(", ");
    return `未知的 provider "${input.provider.trim()}"，已注册的有：${valid}`;
  }
  return null;
}
