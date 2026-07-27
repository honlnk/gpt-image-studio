import type { FastifyInstance } from "fastify";
import { loopbackGuard } from "../middleware/loopback.js";
import {
  clearOssCredentials,
  loadOssCredentials,
  saveOssCredentials,
  toOssCredentialsView,
  type OssCredentials,
} from "../storage/ossCredentials.js";
import { testOssConnection } from "../storage/ossImageStore.js";

/**
 * OSS 凭据管理路由。
 *
 * 鉴权：loopbackGuard（onRequest），与 /credentials/* 同级别保护。
 * OSS AccessKey 是敏感凭据（长期 AK，能读写整个 bucket），不应跨域暴露，
 * 所以走管理面守卫而非 bearer accessKey 数据面。
 *
 * 安全：
 * - GET 不返回 accessKeySecret，只返回脱敏视图（accessKeyIdMasked）。
 * - PUT 写入前做连通性测试，失败则拒绝保存（避免无效凭据残留）。
 * - 注册顺序：在 authMiddleware 之前（loopbackGuard 自带，否则被 bearer 拦 401）。
 */
type StorageOssRoutesOptions = {
  allowedOrigins?: string[];
};

export async function storageOssRoutes(app: FastifyInstance, opts?: StorageOssRoutesOptions) {
  await loopbackGuard(app, opts?.allowedOrigins ?? []);

  /** GET /storage/oss/config —— 返回脱敏视图（不泄露 accessKeySecret）。 */
  app.get("/storage/oss/config", async (_req, reply) => {
    const creds = loadOssCredentials();
    if (!creds) {
      return reply.status(404).send({ configured: false });
    }
    return toOssCredentialsView(creds);
  });

  /** PUT /storage/oss/config —— 写入 OSS 凭据（先连通性测试）。 */
  app.put("/storage/oss/config", async (req, reply) => {
    const body = req.body as Partial<OssCredentials>;
    const validation = validateOssConfig(body);
    if (validation) {
      return reply.status(400).send({ error: validation });
    }

    const creds: OssCredentials = {
      endpoint: body.endpoint!,
      bucket: body.bucket!,
      accessKeyId: body.accessKeyId!,
      accessKeySecret: body.accessKeySecret!,
    };

    // 连通性测试（失败则拒绝保存）
    const test = await testOssConnection(creds);
    if (!test.ok) {
      return reply.status(400).send({
        error: `OSS 连通性测试失败：${test.error}`,
        connected: false,
      });
    }

    saveOssCredentials(creds);
    return { saved: true, connected: true };
  });

  /** DELETE /storage/oss/config —— 删除 OSS 凭据。 */
  app.delete("/storage/oss/config", async () => {
    clearOssCredentials();
    return { deleted: true };
  });

  /** POST /storage/oss/test —— 连通性测试（不保存）。 */
  app.post("/storage/oss/test", async (req, reply) => {
    const body = req.body as Partial<OssCredentials>;
    const validation = validateOssConfig(body);
    if (validation) {
      return reply.status(400).send({ error: validation });
    }
    const test = await testOssConnection({
      endpoint: body.endpoint!,
      bucket: body.bucket!,
      accessKeyId: body.accessKeyId!,
      accessKeySecret: body.accessKeySecret!,
    });
    if (!test.ok) {
      return reply.status(400).send({ connected: false, error: test.error });
    }
    return { connected: true };
  });
}

function validateOssConfig(body: Partial<OssCredentials>): string | undefined {
  if (!body) return "请求体为空";
  if (typeof body.endpoint !== "string" || body.endpoint.length === 0) {
    return "endpoint 缺失";
  }
  if (typeof body.bucket !== "string" || body.bucket.length === 0) {
    return "bucket 缺失";
  }
  if (typeof body.accessKeyId !== "string" || body.accessKeyId.length === 0) {
    return "accessKeyId 缺失";
  }
  if (typeof body.accessKeySecret !== "string" || body.accessKeySecret.length === 0) {
    return "accessKeySecret 缺失";
  }
  return undefined;
}
