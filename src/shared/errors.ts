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

export function isApiConfigurationError(error: unknown) {
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
    "请先在设置里填写",
    "尚未与本地 companion 配对",
  ].some((pattern) => message.includes(pattern));
}
