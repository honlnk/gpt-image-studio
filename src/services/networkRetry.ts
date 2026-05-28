const MAX_RETRIES = 10;
const BASE_DELAY_MS = 2000;

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: () => boolean,
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
      console.info(`[networkRetry] attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error("unreachable");
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && error.message.includes("服务器主动断开了连接"));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
