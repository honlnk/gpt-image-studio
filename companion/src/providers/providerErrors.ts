/**
 * Provider 调用的错误分类。
 *
 * 此前 providerHttp.ts 用一句 `UPSTREAM_DISCONNECT_MESSAGE` 把所有网络层异常
 * 统一甩锅给「内容审核」，导致 DNS 失败、TLS 错误、连接重置、真正的超时
 * 全部显示成"提示词不合规"——这是反直觉的归因，让用户改提示词修不了真实问题。
 *
 * 本模块按 errno / DOMException name / HTTP 状态把异常分类成 `ProviderErrorCategory`，
 * 让 route 层能把准确的 category + 文案回传给 Web：
 *
 *   - 网络层（fetch 抛异常）：按 errno → dns / tls / reset / refused / network / aborted
 *   - HTTP 层（拿到响应但非 2xx）：按状态码 → http_4xx / rate_limited / http_5xx
 *
 * `content_policy` 类目保留但不主动触发：当前所有 provider 都不返回可识别的审核字段，
 * 真要做的话需要在 buildHttpErrorFromResponse 里按响应 payload 命中 `safety`/
 * `data_inspection_disabled` 等字段，留作后续扩展。
 *
 * `timeout` 类目保留但当前不会触发：本 companion 不设主请求超时（生图任务正常
 * 可能 5+ 分钟），未来若加上 timeout 机制，无需改响应 shape 即可分类。
 */

/**
 * 错误分类标签。route 层据此构造 502 body 的 `category` 字段；
 * Web 端当前不消费 category（向后兼容），后续可按它做差异化 UI/重试策略。
 */
export type ProviderErrorCategory =
  | "aborted"
  | "timeout"
  | "dns"
  | "tls"
  | "reset"
  | "refused"
  | "network"
  | "http_4xx"
  | "rate_limited"
  | "http_5xx"
  | "content_policy"
  | "unknown";

/**
 * Provider 调用异常的统一类型。
 *
 * - `category` 是结构化分类，供 route 层透传给 Web。
 * - `message` 是中文用户可读文案（不带敏感信息）。
 * - `status` 在 HTTP 层错误时携带上游 HTTP 状态码，网络层错误时为 undefined。
 * - `cause` 保留原始异常用于日志/调试（不进入响应体）。
 *
 * 范式参考既有 `UnsafeOutboundAddressError`（this.name = 类名）+ `RetryableDownloadError`
 * （ES2022 `super(message, { cause })`）。
 */
export class ProviderCallError extends Error {
  readonly category: ProviderErrorCategory;
  readonly status?: number;

  constructor(
    message: string,
    category: ProviderErrorCategory,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderCallError";
    this.category = category;
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

/**
 * Errno → category 映射。命中顺序：先 AbortError/timeout（DOMException name），
 * 再 TLS code 前缀，再具体 errno，最后兜底。
 *
 * 关键设计：DNS（ENOTFOUND / EAI_AGAIN）和 TLS（ERR_TLS / ERR_SSL / ERR_CERT）
 * 单独分类，因为这两类对应的修复动作（改域名/检查证书/检查本机时间）和重试完全不同。
 */
const ERRNO_TO_CATEGORY: Readonly<Record<string, ProviderErrorCategory>> = {
  // DNS
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  // 连接被拒（端口未开/防火墙）
  ECONNREFUSED: "refused",
  // 连接被重置 / 管道破裂（部分 provider 的审核也表现为 reset，所以保留审核猜测文案）
  ECONNRESET: "reset",
  EPIPE: "reset",
  // 网络不可达
  ENETUNREACH: "network",
  EHOSTUNREACH: "network",
  // 真实超时（目前 provider 主请求不设 timeout，所以这条一般不触发）
  ETIMEDOUT: "timeout",
  ESOCKETTIMEDOUT: "timeout",
};

/**
 * 网络层 category → 用户可读文案（中文，UI 语言）。
 * 文案不带敏感信息，可直接拼进 502 响应体。
 */
export const NETWORK_ERROR_MESSAGES: Readonly<Record<ProviderErrorCategory, string>> = {
  aborted: "请求已被取消。",
  timeout: "Provider 响应超时，请稍后重试。",
  dns: "无法解析 Provider 域名，请检查 apiBaseUrl 配置或本机 DNS。",
  tls: "TLS 握手失败，请检查证书或本机时间设置。",
  // reset 类保留"可能触发审核"的猜测——ECONNRESET 确实是部分 provider 审核的真实表征，
  // 但局限到这一类，不再扩散到所有网络异常。
  reset: "Provider 在响应前断开了连接。可能是网络抖动，或提示词触发了平台审核。",
  refused: "Provider 拒绝连接（ECONNREFUSED），请检查 apiBaseUrl 与端口。",
  network: "无法连接 Provider，请检查网络后重试。",
  // HTTP 层文案由 buildHttpErrorFromResponse 用上游 message 优先覆盖，下面三条是兜底
  http_4xx: "Provider 拒绝了请求，请检查凭据或参数。",
  rate_limited: "Provider 触发限流，请稍后重试。",
  http_5xx: "Provider 服务端故障，请稍后重试。",
  content_policy: "提示词可能触发了 Provider 的内容审核策略。",
  unknown: "Provider 连接失败，未返回任何响应。",
};

/**
 * 把 fetch 抛出的网络层异常分类成 ProviderCallError。
 *
 * 输入通常是 Node fetch 的 TypeError("fetch failed") with cause，
 * 或直接带 code 的 Error，或 DOMException（AbortError/TimeoutError）。
 * 原始异常作为 cause 保留，方便日志排查。
 */
export function classifyNetworkError(error: unknown): ProviderCallError {
  const { name, code } = readErrorSignals(error);
  const category = mapSignalsToCategory(name, code);
  const message = NETWORK_ERROR_MESSAGES[category];
  return new ProviderCallError(message, category, { cause: error });
}

/**
 * 从异常对象读取用于分类的信号（name + code）。
 * Node fetch 的 `TypeError("fetch failed")` 把真错误藏在 cause 里，要往里挖一层。
 *
 * 直接 name 只有在是已知 DOMException name（AbortError/TimeoutError）时才采纳；
 * 否则继续看 cause（TypeError 本身的 name 没分类意义）。
 */
function readErrorSignals(error: unknown): { name?: string; code?: string } {
  const direct = extractSignals(error);
  if (direct.code) return direct;
  if (direct.name && isKnownDomExceptionName(direct.name)) return direct;
  // Node fetch 的典型形状：TypeError("fetch failed") + cause 里才是真正的 ENOTFOUND
  const cause = (error as { cause?: unknown })?.cause;
  return extractSignals(cause);
}

function isKnownDomExceptionName(name: string): boolean {
  return name === "AbortError" || name === "TimeoutError";
}

function extractSignals(value: unknown): { name?: string; code?: string } {
  if (!value || typeof value !== "object") return {};
  const obj = value as { name?: unknown; code?: unknown };
  return {
    name: typeof obj.name === "string" ? obj.name : undefined,
    code: typeof obj.code === "string" ? obj.code : undefined,
  };
}

function mapSignalsToCategory(name?: string, code?: string): ProviderErrorCategory {
  // AbortError：客户端取消或主动 abort 触发，优先判定
  if (name === "AbortError") return "aborted";
  // timeout（AbortSignal.timeout 抛 TimeoutError；ETIMEDOUT errno）
  if (name === "TimeoutError") return "timeout";

  if (code) {
    // 先精确匹配 errno
    const exact = ERRNO_TO_CATEGORY[code];
    if (exact) return exact;
    // 再前缀匹配 TLS/SSL/CERT
    if (isTlsCode(code)) return "tls";
  }
  return "unknown";
}

function isTlsCode(code: string): boolean {
  // 精确按 TLS/SSL/CERT 相关前缀判断；"ERR_" 单独前缀太宽（会吃掉所有 Node ERR_），
  // 这里只在 code 同时包含 TLS/SSL/CERT 关键字时判为 TLS。
  const upper = code.toUpperCase();
  return upper.includes("TLS") || upper.includes("SSL") || upper.includes("CERT");
}

/**
 * 根据 HTTP 响应状态码 + payload 构造 HTTP 层错误。
 *
 * message 优先级：
 *   1. 上游 error.message（OpenAI 风格错误响应里的可读描述）
 *   2. 按 category 的兜底文案（如"Provider 触发限流，请稍后重试。"）
 *   3. 兜底的兜底（status 不在 4xx/5xx 范围时，category=unknown，用 `请求失败：HTTP {status}`）
 *
 * 设计意图：缺 detail 时给用户能理解的分类文案，而不是裸 "请求失败：HTTP 429"
 * 这种暴露 HTTP 状态的实现细节。
 *
 * @param status     上游 HTTP 状态码
 * @param detail     从响应体抽取的上游错误描述（可能为 null）
 * @returns          ProviderCallError，category 在 http_4xx/rate_limited/http_5xx
 */
export function buildHttpErrorFromResponse(
  status: number,
  detail: string | null,
): ProviderCallError {
  const category = httpStatusToCategory(status);
  const message =
    detail ??
    NETWORK_ERROR_MESSAGES[category] ??
    `请求失败：HTTP ${status}`;
  return new ProviderCallError(message, category, { status });
}

function httpStatusToCategory(status: number): ProviderErrorCategory {
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "http_5xx";
  if (status >= 400 && status < 500) return "http_4xx";
  return "unknown";
}
