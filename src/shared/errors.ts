import { ApiClientError, isApiClientError, type ApiErrorCode } from "./apiErrorCodes";

export { ApiClientError, isApiClientError } from "./apiErrorCodes";
export type { ApiErrorCode } from "./apiErrorCodes";

const DEFAULT_SYNTAX_ERROR_MESSAGE = "图片接口返回了无法解析的响应。";

export function formatError(
  error: unknown,
  syntaxErrorMessage = DEFAULT_SYNTAX_ERROR_MESSAGE,
) {
  if (error instanceof SyntaxError) {
    return syntaxErrorMessage;
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * 「配置类错误」判定（生成失败时引导用户去设置面板修凭据/模式）。
 *
 * i18n 改造（docs/plans/i18n-plan.md 阶段 1）：自有抛错点一律带 ApiErrorCode
 * （见 apiErrorCodes.ts），判定优先走 code，不再依赖我们自己文案的文本匹配。
 * 消息模式匹配仅保留给「服务端返回的鉴权文案」兜底——provider/中转返回的
 * detail 文案不受我们控制、无法在抛错点挂 code，401/403 之外仍可能有
 * 「Incorrect API key provided」这类 400 响应。
 */
export function isApiConfigurationError(error: unknown) {
  if (isApiClientError(error)) return true;

  const message = formatError(error).toLowerCase();

  return [
    "api key",
    "apikey",
    "authorization",
    "unauthorized",
    "forbidden",
    "invalid_api_key",
    "incorrect api key",
    "http 401",
    "http 403",
  ].some((pattern) => message.includes(pattern));
}
