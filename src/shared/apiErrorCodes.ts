/**
 * API 客户端错误码（i18n 改造阶段 1，docs/plans/i18n-plan.md）。
 *
 * 背景：isApiConfigurationError 原本按中文消息文本匹配分类错误，文案翻译成
 * 英文后分类会失灵。改为：自有抛错点抛 ApiClientError 携带稳定 code，
 * 展示层用 t(`errors.api.<code>`) 渲染（阶段 2d 接入）。
 */
export const API_ERROR_CODES = [
  /** 直连模式未填写 API key。 */
  "api-key-missing",
  /** 直连模式未填写 API Base URL。 */
  "base-url-missing",
  /** Companion 模式未输入连接密钥（未配对）。 */
  "companion-not-paired",
  /** Companion 模式不支持当前 apiMode（仅 Images API）。 */
  "companion-images-only",
  /** 服务端返回 401/403（key 无效 / 无权限）。 */
  "api-auth",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}
