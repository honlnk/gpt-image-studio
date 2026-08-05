/**
 * OssImageStore —— 阿里云 OSS 图片存储 adapter（D6 选项 C）。
 *
 * 图片上传到 OSS bucket，本地（业务 db）只存引用（blobKey = OSS object key）。
 * 元数据本地、图片云端，边界清晰（D7 OSS 数据集特殊情况的落地）。
 *
 * 凭据从 oss-credentials.json 读取（本机模式长期 AK；阶段三改为 STS 临时凭证 D11）。
 *
 * object key 规则：`${prefix}${blobKey}`。prefix 用于隔离不同数据集/用途，
 * 默认 "gpt-image-studio/"。
 */
import OSS from "ali-oss";
import type { ImageStore, LoadedImage, SavedImage } from "./imageStore.js";
import type { OssCredentials } from "./ossCredentials.js";
import type { StsCredentials } from "./stsCredentials.js";

export function createOssImageStore(opts: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  prefix: string;
  /** 测试用：注入 mock client，跳过真实 OSS 调用。 */
  clientOverride?: OssLikeClient;
}): ImageStore {
  const { prefix, clientOverride } = opts;
  const normalizedPrefix = normalizePrefix(prefix);

  // 惰性创建 client（避免构造时就连通），测试时用 clientOverride
  let client: OssLikeClient | null = clientOverride ?? null;
  function getClient(): OssLikeClient {
    if (!client) {
      client = new OSS({
        endpoint: opts.endpoint,
        accessKeyId: opts.accessKeyId,
        accessKeySecret: opts.accessKeySecret,
        bucket: opts.bucket,
        secure: true,
      }) as unknown as OssLikeClient;
    }
    return client;
  }

  function objectKey(blobKey: string): string {
    return `${normalizedPrefix}${blobKey}`;
  }

  return {
    kind: "oss",

    async save(key: string, data: Buffer, mimeType: string): Promise<SavedImage> {
      await getClient().put(objectKey(key), data, {
        mime: mimeType,
        headers: { "Content-Type": mimeType },
      });
      return { size: data.byteLength, mimeType };
    },

    async load(key: string): Promise<LoadedImage | undefined> {
      try {
        const result = await getClient().get(objectKey(key));
        // ali-oss get 返回 { content: Buffer, res: { headers } }
        const content = (result as { content: Buffer }).content;
        const mimeType =
          (result as { res?: { headers?: Record<string, string> } }).res?.headers?.[
            "content-type"
          ] ?? "application/octet-stream";
        return { data: content, mimeType };
      } catch (err) {
        // NoSuchKey 等错误视为不存在
        if (isNotFoundError(err)) return undefined;
        throw err;
      }
    },

    async remove(key: string): Promise<void> {
      try {
        await getClient().delete(objectKey(key));
      } catch (err) {
        if (isNotFoundError(err)) return;
        throw err;
      }
    },

    async estimateBytes(): Promise<number> {
      // listObjects 遍历 prefix 下所有对象累加 size
      let total = 0;
      let marker: string | undefined;
      const c = getClient();
      do {
        const list = await c.list(
          { prefix: normalizedPrefix, "max-keys": 1000, marker },
          {},
        );
        const objects = (list as { objects?: { size?: number }[] }).objects ?? [];
        for (const obj of objects) {
          total += obj.size ?? 0;
        }
        // 是否还有下一页
        if ((list as { isTruncated?: boolean }).isTruncated) {
          marker = (list as { nextMarker?: string }).nextMarker;
        } else {
          marker = undefined;
        }
      } while (marker);
      return total;
    },
  };
}

/**
 * 创建 STS 感知的 OssImageStore（阶段三 PR4，D11 服务器模式）。
 *
 * 与 createOssImageStore 的区别：凭证不固定，每次操作前从 getStsCredentials 拿
 * 临时凭证（宿主签发，带 TTL），STS 变了就重建 client。
 *
 * STS 响应的 prefix 已由宿主限定到该用户（users/<userId>/），Companion 据此拼 object key。
 *
 * @param getUserId 返回当前用户 id（用于 STS 获取，前缀隔离）
 * @param getStsCredentials STS 凭证获取回调（带缓存，见 stsCredentials.ts）
 * @param clientFactory 测试用：注入 mock client 工厂（按 STS 凭证建 client）
 */
export function createStsOssImageStore(opts: {
  getUserId: () => string;
  getStsCredentials: (userId: string) => Promise<StsCredentials>;
  /** 测试用：按 STS 凭证构造 client。生产用默认 ali-oss。 */
  clientFactory?: (creds: StsCredentials) => OssLikeClient;
}): ImageStore {
  const { getUserId, getStsCredentials } = opts;
  // 缓存当前 STS + 对应 client，STS 变了才重建
  let currentCreds: StsCredentials | null = null;
  let client: OssLikeClient | null = null;

  async function ensureClient(): Promise<{ client: OssLikeClient; prefix: string }> {
    const userId = getUserId();
    const creds = await getStsCredentials(userId);
    // STS 变了（accessKeyId 不同）或首次 → 重建 client
    if (!currentCreds || currentCreds.accessKeyId !== creds.accessKeyId) {
      currentCreds = creds;
      client = opts.clientFactory
        ? opts.clientFactory(creds)
        : new OSS({
            endpoint: `https://${creds.region}.aliyuncs.com`,
            accessKeyId: creds.accessKeyId,
            accessKeySecret: creds.accessKeySecret,
            stsToken: creds.securityToken,
            bucket: creds.bucket,
            secure: true,
          }) as unknown as OssLikeClient;
    }
    return { client: client!, prefix: normalizePrefix(creds.prefix) };
  }

  return {
    kind: "oss",

    async save(key: string, data: Buffer, mimeType: string): Promise<SavedImage> {
      const { client: c, prefix } = await ensureClient();
      await c.put(`${prefix}${key}`, data, {
        mime: mimeType,
        headers: { "Content-Type": mimeType },
      });
      return { size: data.byteLength, mimeType };
    },

    async load(key: string): Promise<LoadedImage | undefined> {
      const { client: c, prefix } = await ensureClient();
      try {
        const result = await c.get(`${prefix}${key}`);
        const content = (result as { content: Buffer }).content;
        const mimeType =
          (result as { res?: { headers?: Record<string, string> } }).res?.headers?.[
            "content-type"
          ] ?? "application/octet-stream";
        return { data: content, mimeType };
      } catch (err) {
        if (isNotFoundError(err)) return undefined;
        throw err;
      }
    },

    async remove(key: string): Promise<void> {
      const { client: c, prefix } = await ensureClient();
      try {
        await c.delete(`${prefix}${key}`);
      } catch (err) {
        if (isNotFoundError(err)) return;
        throw err;
      }
    },

    async estimateBytes(): Promise<number> {
      const { client: c, prefix } = await ensureClient();
      let total = 0;
      let marker: string | undefined;
      do {
        const list = await c.list({ prefix, "max-keys": 1000, marker }, {});
        const objects = list.objects ?? [];
        for (const obj of objects) {
          total += obj.size ?? 0;
        }
        if (list.isTruncated) {
          marker = list.nextMarker;
        } else {
          marker = undefined;
        }
      } while (marker);
      return total;
    },
  };
}

/** ali-oss 客户端的最小类型抽象（便于测试注入 mock）。 */
export type OssLikeClient = {
  put(
    name: string,
    data: Buffer,
    options?: { mime?: string; headers?: Record<string, string> },
  ): Promise<unknown>;
  get(name: string): Promise<{
    content: Buffer;
    res?: { headers?: Record<string, string> };
  }>;
  delete(name: string): Promise<unknown>;
  list(
    query: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{
    objects?: { size?: number }[];
    isTruncated?: boolean;
    nextMarker?: string;
  }>;
};

/** 归一化 prefix：确保以 / 结尾（空 prefix 允许）。 */
function normalizePrefix(prefix: string): string {
  if (!prefix) return "";
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

/** 判断 ali-oss 错误是否为「对象不存在」。 */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; status?: number; name?: string };
  return (
    e.code === "NoSuchKey" ||
    e.status === 404 ||
    e.name === "NoSuchKeyError"
  );
}

/** 连通性测试：用 listObjects 探测凭据有效性（不实际下载）。 */
export async function testOssConnection(
  creds: OssCredentials,
  prefix = "gpt-image-studio",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = new OSS({
      endpoint: creds.endpoint,
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      bucket: creds.bucket,
      secure: true,
    }) as unknown as OssLikeClient;
    await client.list({ prefix, "max-keys": 1 }, {});
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
