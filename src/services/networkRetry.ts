import { t } from "../i18n";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 2000;

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: () => boolean,
  onRetry?: (retryAttempt: number) => void,
): Promise<T> {
  const maxAttempts = shouldRetry() ? MAX_RETRIES : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isNetworkError(error) || !shouldRetry() || attempt === maxAttempts - 1) {
        throw error;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      onRetry?.(attempt + 1);
      console.info(`[networkRetry] attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error("unreachable");
}

function isNetworkError(error: unknown): boolean {
  // 匹配 client.ts / responses.ts 抛出的「服务器主动断开」错误（历史上靠中文文案
  // 前缀 includes）。i18n 后改用 errors.network.serverDisconnectedMarker：其 zh / en
  // 取值必须始终是 errors.api.serverDisconnected 对应语言文案的子串，否则匹配失效。
  // 彻底解法是给该抛错点挂结构化 code（同 apiErrorCodes 模式），留待主线演进。
  return error instanceof TypeError ||
    (error instanceof Error && error.message.includes(t("errors.network.serverDisconnectedMarker")));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
