/**
 * OSS STS 临时凭证获取（阶段三 PR4，D11 平台统一 OSS）。
 *
 * 服务器多用户模式下，长期 AccessKey 只存宿主，Companion 调宿主的 STS 签发接口
 * 拿短期临时凭证（15min~1h 有效期），用完自动续期。
 *
 * STS 契约（Companion → 宿主）：
 *   GET {MAIN_APP_URL}/api/sts/upload-token
 *   Authorization: Bearer {MAIN_APP_API_KEY}   ← 平台级密钥
 *   X-User-Id: <user-id>                        ← 透传当前用户
 *
 *   响应：{ accessKeyId, accessKeySecret, securityToken, expiration,
 *           bucket, region, prefix }            ← prefix 已限定该用户
 *
 * 宿主可随时停止签发新凭证，立即收回用户上传能力（比持有长期 AK 安全得多）。
 */

export type StsCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  /** ISO8601 过期时间（宿主签发时设定，通常 15min~1h）。 */
  expiration: string;
  bucket: string;
  region: string;
  /** 宿主限定的用户前缀（如 users/<user-id>/）。 */
  prefix: string;
};

/** STS 续期提前量：过期前 5 分钟就重新获取，避免临界过期。 */
const STS_RENEWAL_LEAD_MS = 5 * 60 * 1000;

/** 缓存项：creds + 获取时刻。 */
type CacheEntry = { creds: StsCredentials };

/** userId → STS 凭证缓存。不同用户独立缓存（prefix 不同）。 */
const stsCache = new Map<string, CacheEntry>();

/**
 * 宿主 STS 签发接口的 fetch 实现（可注入用于测试）。
 *
 * 默认用全局 fetch；测试可传 mock。
 */
export type StsFetcher = (url: string, init: RequestInit) => Promise<Response>;

/** 默认 fetch 实现。 */
const defaultFetcher: StsFetcher = (url, init) => fetch(url, init);

/**
 * 获取指定用户的 STS 凭证（带提前续期缓存）。
 *
 * 缓存策略：
 * - 缓存命中且 `expiration - 5min > now` → 返回缓存。
 * - 否则调宿主接口重新获取并更新缓存。
 *
 * @throws Error 宿主接口不可达或返回非 200。
 */
export async function getStsCredentials(
  userId: string,
  opts: { fetcher?: StsFetcher } = {},
): Promise<StsCredentials> {
  const cached = stsCache.get(userId);
  if (cached && !isExpiringSoon(cached.creds)) {
    return cached.creds;
  }

  const creds = await fetchStsFromHost(userId, opts.fetcher ?? defaultFetcher);
  stsCache.set(userId, { creds });
  return creds;
}

/** 判断 STS 凭证是否即将过期（需要续期）。 */
function isExpiringSoon(creds: StsCredentials): boolean {
  const expirationMs = Date.parse(creds.expiration);
  if (Number.isNaN(expirationMs)) return true; // 无法解析过期时间，保守续期
  return Date.now() + STS_RENEWAL_LEAD_MS >= expirationMs;
}

/** 调宿主 STS 签发接口。 */
async function fetchStsFromHost(
  userId: string,
  fetcher: StsFetcher,
): Promise<StsCredentials> {
  const mainAppUrl = process.env.MAIN_APP_URL;
  const mainAppApiKey = process.env.MAIN_APP_API_KEY;
  if (!mainAppUrl || !mainAppApiKey) {
    throw new Error(
      "server 模式 OSS 需要 MAIN_APP_URL 和 MAIN_APP_API_KEY 环境变量（宿主 STS 签发接口）",
    );
  }

  const url = `${mainAppUrl.replace(/\/+$/, "")}/api/sts/upload-token`;
  const res = await fetcher(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${mainAppApiKey}`,
      "X-User-Id": userId,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`宿主 STS 签发失败 (${res.status}): ${body}`);
  }

  const data = (await res.json()) as Partial<StsCredentials>;
  if (
    !data.accessKeyId ||
    !data.accessKeySecret ||
    !data.securityToken ||
    !data.expiration ||
    !data.bucket ||
    !data.region
  ) {
    throw new Error("宿主 STS 响应缺少必需字段");
  }
  return {
    accessKeyId: data.accessKeyId,
    accessKeySecret: data.accessKeySecret,
    securityToken: data.securityToken,
    expiration: data.expiration,
    bucket: data.bucket,
    region: data.region,
    prefix: data.prefix ?? "",
  };
}

/** 清空 STS 缓存（测试用）。 */
export function clearStsCache(): void {
  stsCache.clear();
}
