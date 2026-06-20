/**
 * 通用工具：把 provider 返回的图片 URL fetch 下来转成 base64。
 *
 * 适用场景：GLM、豆包等 provider 的 images/generations 返回的是图片 URL
 * （而非 OpenAI 的内联 b64_json）。companion 必须在拿到 URL 后立即 fetch
 * 转换——这些 URL 有时效性，不能缓存稍后用（见计划「风险与开放问题」#6）。
 *
 * 实现：带超时的单次 fetch + 可选重试。失败抛错，由调用方（adapter）转成
 * 给用户看的错误信息。
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

export type UrlToB64Options = {
  /** 单次 fetch 超时（毫秒）。 */
  timeoutMs?: number;
  /** 失败重试次数（不含首次）。 */
  retries?: number;
  /** 可选的 fetch 注入点，测试用。 */
  fetchImpl?: typeof fetch;
};

/**
 * 把图片 URL 转成 base64 字符串（不含 data: 前缀，纯 base64 payload）。
 *
 * @throws Error 当 fetch 失败、超时、或响应不是图片时。
 */
export async function urlToB64(
  url: string,
  options: UrlToB64Options = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const doFetch = options.fetchImpl ?? fetch;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`下载图片失败：HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.toString("base64");
    } catch (error) {
      lastError = error;
      // 最后一次不再等待
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
      }
    }
  }

  throw new Error(
    `下载图片失败（已重试 ${maxRetries} 次）：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避：300ms → 600ms → ... */
function backoffMs(attempt: number): number {
  return 300 * Math.pow(2, attempt);
}
