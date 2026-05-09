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
