import { describe, expect, it } from "vitest";
import { isApiConfigurationError } from "./errors";

describe("isApiConfigurationError", () => {
  it("detects missing local API settings", () => {
    expect(
      isApiConfigurationError(new Error("请先在设置里填写 OpenAI API key。")),
    ).toBe(true);
    expect(
      isApiConfigurationError(new Error("请先在设置里填写 API Base URL。")),
    ).toBe(true);
  });

  it("detects common authentication failures", () => {
    expect(isApiConfigurationError(new Error("请求失败：HTTP 401"))).toBe(true);
    expect(isApiConfigurationError(new Error("Incorrect API key provided."))).toBe(true);
    expect(isApiConfigurationError(new Error("invalid_api_key"))).toBe(true);
  });

  it("ignores unrelated generation errors", () => {
    expect(
      isApiConfigurationError(new Error("gpt-image-2 当前不支持透明背景。")),
    ).toBe(false);
  });
});
