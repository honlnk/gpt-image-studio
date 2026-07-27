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
