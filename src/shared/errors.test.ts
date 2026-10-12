import { describe, expect, it } from "vitest";
import { ApiClientError, isApiClientError } from "./apiErrorCodes";
import { formatError, isApiConfigurationError } from "./errors";

describe("isApiConfigurationError（结构化判定，i18n 阶段 1）", () => {
  it("ApiClientError 一律视为配置类错误（按 code，不依赖消息文本）", () => {
    const cases: Array<[string, ApiClientError]> = [
      ["api-key-missing", new ApiClientError("api-key-missing", "any message")],
      ["base-url-missing", new ApiClientError("base-url-missing", "Some English message")],
      ["companion-not-paired", new ApiClientError("companion-not-paired", "whatever")],
      ["companion-images-only", new ApiClientError("companion-images-only", "lorem ipsum")],
      ["api-auth", new ApiClientError("api-auth", "Request failed: HTTP 401")],
    ];
    for (const [, error] of cases) {
      expect(isApiConfigurationError(error)).toBe(true);
      expect(isApiClientError(error)).toBe(true);
    }
    // 全部 code 都是合法枚举值
    for (const [, error] of cases) {
      expect(error.code).toBeTruthy();
    }
  });

  it("服务端鉴权文案兜底：英文消息模式仍命中（provider 返回、无法挂 code）", () => {
    expect(
      isApiConfigurationError(new Error("Incorrect API key provided.")),
    ).toBe(true);
    expect(isApiConfigurationError(new Error("invalid_api_key"))).toBe(true);
    expect(isApiConfigurationError(new Error("请求失败：HTTP 401"))).toBe(true);
    expect(isApiConfigurationError(new Error("403 Forbidden"))).toBe(true);
  });

  it("普通错误与解析错误不是配置类错误", () => {
    expect(isApiConfigurationError(new Error("network timeout"))).toBe(false);
    expect(
      isApiConfigurationError(new Error("gpt-image-2 当前不支持透明背景。")),
    ).toBe(false);
    expect(isApiConfigurationError(new SyntaxError("Unexpected token"))).toBe(
      false,
    );
  });

  it("formatError：SyntaxError 走默认解析失败文案", () => {
    expect(formatError(new SyntaxError("x"))).toBe(
      "图片接口返回了无法解析的响应。",
    );
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError("plain string")).toBe("plain string");
  });
});
