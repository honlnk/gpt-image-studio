import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";
import {
  assertPublicImageUrl,
  createPublicOnlyLookup,
  UnsafeOutboundAddressError,
} from "./outboundAddressPolicy.js";
import { assertSignatureMatches } from "./imageSignature.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ABORT_ERR",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ESOCKETTIMEDOUT",
  "ETIMEDOUT",
]);

export type ImageDownloadResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  destroy(error?: Error): void;
};

export type ImageRequestOptions = {
  signal: AbortSignal;
  lookup: LookupFunction;
};

export type ImageRequest = (
  url: URL,
  options: ImageRequestOptions,
) => Promise<ImageDownloadResponse>;

export type UrlToB64Options = {
  /** 单次尝试的总超时，包含 DNS、重定向和响应体读取。 */
  timeoutMs?: number;
  /** 瞬时网络错误的重试次数，不含首次。 */
  retries?: number;
  /** 单张 Provider 输出图片允许的最大字节数。 */
  maxBytes?: number;
  /** 单次尝试允许的最大重定向次数。 */
  maxRedirects?: number;
  /** 测试注入点。生产环境使用受控的 HTTPS request。 */
  requestImpl?: ImageRequest;
  /** 测试注入点。生产环境只允许解析到公网地址。 */
  lookup?: LookupFunction;
  /**
   * 外部取消信号（如客户端断开）。与 timeoutMs 的内部超时信号合并后传给 request。
   * 触发时下载立即中止；当前实现下会作为网络错误走重试逻辑（重试时仍会再被 signal 触发，
   * 最终作为 AbortError 类异常抛出）。
   */
  signal?: AbortSignal;
};

/**
 * 下载 Provider 返回的临时图片 URL，并转成不含 data: 前缀的 base64。
 *
 * 返回值同时带出真实 MIME（来自响应 Content-Type + magic bytes 双重校验），
 * 供 adapter 透传给 Web，避免 ImageAsset.mimeType 与字节不符。
 *
 * 安全边界：
 * - 只允许 HTTPS；
 * - DNS 校验与实际 socket 建连使用同一个 lookup；
 * - 每次重定向重新校验；
 * - 只接受 PNG/JPEG/WebP，且 MIME 必须与文件签名一致；
 * - 响应体流式读取并执行严格字节上限。
 */
export async function urlToB64(
  url: string,
  options: UrlToB64Options = {},
): Promise<{ b64Json: string; mimeType: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const requestImpl = options.requestImpl ?? requestImage;
  const lookup = options.lookup ?? createPublicOnlyLookup();

  assertPositiveInteger("timeoutMs", timeoutMs);
  assertNonNegativeInteger("retries", maxRetries);
  assertPositiveInteger("maxBytes", maxBytes);
  assertNonNegativeInteger("maxRedirects", maxRedirects);

  let initialUrl: URL;
  try {
    initialUrl = new URL(url);
  } catch {
    throw new Error("下载图片失败：图片 URL 格式无效。");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const signal = composeDownloadSignal(options.signal, timeoutMs);
      const downloaded = await downloadImage(initialUrl, {
        signal,
        lookup,
        maxBytes,
        maxRedirects,
        requestImpl,
      });
      return { b64Json: downloaded.buffer.toString("base64"), mimeType: downloaded.mimeType };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) {
        throw new Error(`下载图片失败：${errorMessage(error)}`, { cause: error });
      }
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt), options.signal);
      }
    }
  }

  throw new Error(
    `下载图片失败（已重试 ${maxRetries} 次）：${errorMessage(lastError)}`,
    { cause: lastError },
  );
}

type DownloadContext = {
  signal: AbortSignal;
  lookup: LookupFunction;
  maxBytes: number;
  maxRedirects: number;
  requestImpl: ImageRequest;
};

async function downloadImage(
  initialUrl: URL,
  context: DownloadContext,
): Promise<{ buffer: Buffer; mimeType: string }> {
  let currentUrl = initialUrl;
  const visited = new Set<string>();

  for (let redirectCount = 0; ; redirectCount++) {
    assertPublicImageUrl(currentUrl);

    const normalizedUrl = currentUrl.href;
    if (visited.has(normalizedUrl)) {
      throw new DownloadPolicyError("图片 URL 出现重定向循环。");
    }
    visited.add(normalizedUrl);

    const response = await context.requestImpl(currentUrl, {
      signal: context.signal,
      lookup: context.lookup,
    });

    if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
      response.destroy();
      if (redirectCount >= context.maxRedirects) {
        throw new DownloadPolicyError(
          `图片 URL 重定向次数超过上限 ${context.maxRedirects}。`,
        );
      }

      const location = getSingleHeader(response.headers.location);
      if (!location) {
        throw new DownloadPolicyError("图片 URL 重定向缺少 Location。");
      }

      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        throw new DownloadPolicyError("图片 URL 重定向的 Location 无效。");
      }
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      const message = `HTTP ${response.statusCode}`;
      if (
        response.statusCode === 408 ||
        response.statusCode === 429 ||
        response.statusCode >= 500
      ) {
        throw new RetryableDownloadError(message);
      }
      throw new DownloadPolicyError(message);
    }

    try {
      const mimeType = validateResponseHeaders(response.headers, context.maxBytes);
      const buffer = await readBoundedBody(response, context.maxBytes);
      assertSignatureMatches(buffer, mimeType);
      return { buffer, mimeType };
    } catch (error) {
      response.destroy(error instanceof Error ? error : undefined);
      throw error;
    }
  }
}

function requestImage(
  url: URL,
  options: ImageRequestOptions,
): Promise<ImageDownloadResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        signal: options.signal,
        lookup: options.lookup,
        headers: {
          Accept: "image/png,image/jpeg,image/webp",
          "Accept-Encoding": "identity",
          "User-Agent": "gpt-image-studio-companion",
        },
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          destroy: (error?: Error) => response.destroy(error),
        });
      },
    );

    request.once("error", reject);
    request.end();
  });
}

function validateResponseHeaders(
  headers: IncomingHttpHeaders,
  maxBytes: number,
): string {
  const contentEncoding = getSingleHeader(headers["content-encoding"]);
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new DownloadPolicyError(
      `不支持压缩的图片响应：Content-Encoding ${contentEncoding}`,
    );
  }

  const rawContentType = getSingleHeader(headers["content-type"]);
  const mimeType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new DownloadPolicyError(
      `响应不是受支持的图片类型：${mimeType || "缺少 Content-Type"}`,
    );
  }

  const rawContentLength = getSingleHeader(headers["content-length"]);
  if (rawContentLength) {
    if (!/^\d+$/.test(rawContentLength)) {
      throw new DownloadPolicyError("图片响应的 Content-Length 无效。");
    }
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength)) {
      throw new DownloadPolicyError("图片响应的 Content-Length 超出安全范围。");
    }
    if (contentLength > maxBytes) {
      throw new DownloadPolicyError(
        `图片响应超过大小上限 ${formatBytes(maxBytes)}。`,
      );
    }
  }

  return mimeType;
}

async function readBoundedBody(
  response: ImageDownloadResponse,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        const error = new DownloadPolicyError(
          `图片响应超过大小上限 ${formatBytes(maxBytes)}。`,
        );
        response.destroy(error);
        throw error;
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof DownloadPolicyError) {
      throw error;
    }
    throw new RetryableDownloadError(
      `读取图片响应失败：${errorMessage(error)}`,
      error,
    );
  }

  if (totalBytes === 0) {
    throw new DownloadPolicyError("图片响应内容为空。");
  }

  return Buffer.concat(chunks, totalBytes);
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new DownloadPolicyError("图片响应包含重复的安全敏感 Header。");
    }
    return value[0];
  }
  return value;
}

class DownloadPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadPolicyError";
  }
}

class RetryableDownloadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RetryableDownloadError";
  }
}

function isRetryable(error: unknown): boolean {
  if (
    error instanceof DownloadPolicyError ||
    error instanceof UnsafeOutboundAddressError
  ) {
    return false;
  }
  // 外部取消（客户端断开）触发的 abort 立即失败，不重试——重试只会让取消生效更晚。
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof RetryableDownloadError) {
    return true;
  }

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && RETRYABLE_NETWORK_ERROR_CODES.has(code);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数。`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数。`);
  }
}

function formatBytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}

/**
 * 合并外部取消信号与 timeout 超时信号。
 *
 * - 外部 signal（客户端断开）触发时下载立即中止，且错误归类为 AbortError（不重试）。
 * - timeout signal 触发时归类为 ESOCKETTIMEDOUT（可重试）。
 *
 * AbortSignal.any 在 Node ≥ 20 可用，与 companion 的 engines.node 要求一致。
 */
function composeDownloadSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (external === undefined) return timeoutSignal;
  if (external.aborted) return external;
  return AbortSignal.any([external, timeoutSignal]);
}

function sleep(ms: number, externalSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      externalSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 指数退避：300ms → 600ms → ... */
function backoffMs(attempt: number): number {
  return 300 * Math.pow(2, attempt);
}
