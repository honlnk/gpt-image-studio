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
import { adminKeyGuard } from "../middleware/adminAuth.js";
import {
  consumeCorruptionEvent,
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
  activateCredential,
} from "../credentials.js";
import { withStoreErrorBoundary } from "./storeRouteWrapper.js";
import { parseCredentialInput, validateCredentialInput } from "./credentialInput.js";

/**
 * 平台级凭据管理路由（/admin/credentials/*）—— server 模式多租户的管理面。
 *
 * 与 routes/credentials.ts（/credentials/*，loopbackGuard）是同一套凭据 CRUD 的
 * **另一套鉴权入口**，端点结构一一对应，区别只在信任模型：
 *
 * | 入口 | 鉴权 | 适用场景 |
 * |---|---|---|
 * | /credentials/* | loopbackGuard（本机/白名单） | local 模式本机浏览器操作 |
 * | /admin/credentials/* | ADMIN_API_KEY（平台级） | server 模式宿主后端/操作员远程管理 |
 *
 * 两者读写同一个凭据存储（~/.gpt-image-studio/credentials.json），业务逻辑完全复用
 * credentials.ts 的函数。凭据是**平台级共享**的——所有租户用户共用管理员配的这套，
 * 不按用户隔离（与 local 模式语义一致：都是"这个 companion 实例的凭据"）。
 *
 * 背景：commit 657c172 在 server 模式禁用了默认管理页（/admin 页面 + /admin/api/*），
 * 因为它们的数据集视图写死 __local__ 虚拟用户、多租户下误导。但凭据管理没有这个
 * 问题（凭据本就跨租户共享），server 模式需要一条可远程访问的凭据管理路径——本路由即此。
 *
 * 注册顺序（见 server.ts）：必须在 authMiddleware 之前注册（/admin 前缀已被
 * authMiddleware 的 LOOPBACK_GUARDED_PREFIXES 跳过），紧跟 adminRevokeRoutes 之后。
 */
export async function adminCredentialsRoutes(app: FastifyInstance) {
  // 平台级管理密钥守卫（ADMIN_API_KEY）。未配置/错误密钥 → 401。
  // 不装 loopbackGuard——本路由面向远程宿主，信任模型是平台密钥而非本机来源。
  await adminKeyGuard(app);

  app.get<{ Reply: ProviderPreset[] }>("/admin/credentials/presets", async () => {
    return PROVIDER_PRESETS;
  });

  app.get<{ Reply: CompanionCredentialsListResponse }>("/admin/credentials", async (_req, reply) => {
    return withStoreErrorBoundary(reply, () => {
      const store = listCredentials();
      const event = consumeCorruptionEvent();
      if (event) {
        reply.status(500);
        return { error: event.message, corrupt: true } as never;
      }
      return store;
    });
  });

  app.post<{
    Body: CompanionCredentialInput;
    Reply: CompanionCredentialMutationResponse;
  }>("/admin/credentials", async (req, reply) => {
    const input = parseCredentialInput(req.body);
    const error = validateCredentialInput(input);
    if (error) {
      return reply.status(400).send({ error } as never);
    }
    return withStoreErrorBoundary(reply, () => {
      const entry = addCredential(input);
      return { ok: true, entry };
    });
  });

  app.put<{
    Params: { id: string };
    Body: CompanionCredentialInput;
    Reply: CompanionCredentialMutationResponse;
  }>("/admin/credentials/:id", async (req, reply) => {
    const input = parseCredentialInput(req.body);
    const error = validateCredentialInput(input);
    if (error) {
      return reply.status(400).send({ error } as never);
    }
    return withStoreErrorBoundary(reply, () => {
      const entry = updateCredential(req.params.id, input);
      if (!entry) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true, entry };
    });
  });

  app.delete<{
    Params: { id: string };
    Reply: CompanionCredentialDeleteResponse;
  }>("/admin/credentials/:id", async (req, reply) => {
    return withStoreErrorBoundary(reply, () => {
      const removed = removeCredential(req.params.id);
      if (!removed) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true };
    });
  });

  app.post<{
    Params: { id: string };
    Reply: CompanionCredentialActivateResponse;
  }>("/admin/credentials/:id/activate", async (req, reply) => {
    return withStoreErrorBoundary(reply, () => {
      const ok = activateCredential(req.params.id);
      if (!ok) {
        return reply.status(404).send({ error: "凭据不存在" } as never);
      }
      return { ok: true, activeId: req.params.id };
    });
  });
}
