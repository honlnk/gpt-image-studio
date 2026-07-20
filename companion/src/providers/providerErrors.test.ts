import { describe, expect, it } from "vitest";
import {
  ProviderCallError,
  buildHttpErrorFromResponse,
  classifyNetworkError,
  NETWORK_ERROR_MESSAGES,
  type ProviderErrorCategory,
} from "./providerErrors.js";

/**
 * 构造一个带 code 属性的 Error（模拟 Node fetch 的网络层 errno）。
 * 沿用 urlToB64.test.ts 的 Object.assign 范式。
 */
function errnoError(code: string, message = "fetch failed"): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifyNetworkError — errno mapping", () => {
  const cases: Array<{ code: string; category: ProviderErrorCategory }> = [
    { code: "ENOTFOUND", category: "dns" },
    { code: "EAI_AGAIN", category: "dns" },
    { code: "ECONNREFUSED", category: "refused" },
    { code: "ECONNRESET", category: "reset" },
    { code: "EPIPE", category: "reset" },
    { code: "ENETUNREACH", category: "network" },
    { code: "EHOSTUNREACH", category: "network" },
    { code: "ETIMEDOUT", category: "timeout" },
    { code: "ESOCKETTIMEDOUT", category: "timeout" },
  ];

  for (const { code, category } of cases) {
    it(`maps ${code} to ${category}`, () => {
      const err = classifyNetworkError(errnoError(code));
      expect(err).toBeInstanceOf(ProviderCallError);
      expect(err.category).toBe(category);
      expect(err.message).toBe(NETWORK_ERROR_MESSAGES[category]);
      expect(err.cause).toBeInstanceOf(Error);
      expect((err.cause as Error).message).toBe("fetch failed");
    });
  }
});

describe("classifyNetworkError — TLS code prefix", () => {
  // Node/OpenSSL 的 TLS 错误 code 形态：ERR_TLS_* / ERR_SSL_*（现代 Node）
  // 或裸 OpenSSL code（旧版 Node）：CERT_HAS_EXPIRED / SELF_SIGNED_CERT_IN_CHAIN 等。
  // 通过 code 大写后是否含 TLS/SSL/CERT 关键字判定。
  const tlsCodes = [
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "CERT_HAS_EXPIRED",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ];

  for (const code of tlsCodes) {
    it(`maps ${code} to tls (substring match on TLS/SSL/CERT)`, () => {
      const err = classifyNetworkError(errnoError(code));
      expect(err.category).toBe("tls");
    });
  }

  it("does NOT misclassify unrelated ERR_ codes as tls", () => {
    // ERR_OUT_OF_MEMORY 含 ERR_ 但不含 TLS/SSL/CERT，不应归 tls
    const err = classifyNetworkError(errnoError("ERR_OUT_OF_MEMORY"));
    expect(err.category).not.toBe("tls");
  });
});

describe("classifyNetworkError — DOMException name mapping", () => {
  it("maps AbortError to aborted", () => {
    const err = classifyNetworkError(new DOMException("aborted", "AbortError"));
    expect(err.category).toBe("aborted");
  });

  it("maps TimeoutError to timeout", () => {
    const err = classifyNetworkError(new DOMException("timed out", "TimeoutError"));
    expect(err.category).toBe("timeout");
  });
});

describe("classifyNetworkError — Node fetch wrapped cause", () => {
  it("unwraps TypeError('fetch failed') and inspects cause.code", () => {
    // Node fetch 的典型形状：TypeError("fetch failed") with cause = real error
    const real = errnoError("ENOTFOUND", "getaddrinfo ENOTFOUND api.example.com");
    const wrapper = Object.assign(new TypeError("fetch failed"), { cause: real });

    const err = classifyNetworkError(wrapper);
    expect(err.category).toBe("dns");
    expect(err.cause).toBe(wrapper);
  });

  it("falls back to unknown when both direct and cause lack signals", () => {
    const err = classifyNetworkError(new Error("something weird"));
    expect(err.category).toBe("unknown");
  });

  it("returns unknown for non-Error input", () => {
    const err = classifyNetworkError("just a string");
    expect(err.category).toBe("unknown");
    expect(err.message).toBe(NETWORK_ERROR_MESSAGES.unknown);
  });
});

describe("buildHttpErrorFromResponse — HTTP status mapping", () => {
  const cases: Array<{ status: number; category: ProviderErrorCategory }> = [
    { status: 400, category: "http_4xx" },
    { status: 401, category: "http_4xx" },
    { status: 403, category: "http_4xx" },
    { status: 404, category: "http_4xx" },
    { status: 422, category: "http_4xx" },
    { status: 429, category: "rate_limited" },
    { status: 500, category: "http_5xx" },
    { status: 502, category: "http_5xx" },
    { status: 503, category: "http_5xx" },
    { status: 599, category: "http_5xx" },
  ];

  for (const { status, category } of cases) {
    it(`maps HTTP ${status} to ${category}`, () => {
      const err = buildHttpErrorFromResponse(status, null);
      expect(err).toBeInstanceOf(ProviderCallError);
      expect(err.category).toBe(category);
      expect(err.status).toBe(status);
      // 无 detail 时用兜底文案
      expect(err.message).toBe(NETWORK_ERROR_MESSAGES[category]);
    });
  }

  it("prefers upstream detail over fallback message", () => {
    const err = buildHttpErrorFromResponse(400, "Invalid size parameter");
    expect(err.message).toBe("Invalid size parameter");
    expect(err.category).toBe("http_4xx");
  });

  it("uses unknown fallback message when status is outside 4xx/5xx (e.g. 3xx)", () => {
    // 罕见的非 4xx/5xx 状态码 → category=unknown，用 NETWORK_ERROR_MESSAGES.unknown 兜底
    const err = buildHttpErrorFromResponse(301, null);
    expect(err.category).toBe("unknown");
    expect(err.message).toBe(NETWORK_ERROR_MESSAGES.unknown);
  });
});

describe("ProviderCallError — shape", () => {
  it("sets name to ProviderCallError", () => {
    const err = new ProviderCallError("msg", "dns");
    expect(err.name).toBe("ProviderCallError");
    expect(err instanceof Error).toBe(true);
  });

  it("preserves cause and status", () => {
    const cause = new Error("orig");
    const err = new ProviderCallError("msg", "http_5xx", { cause, status: 502 });
    expect(err.cause).toBe(cause);
    expect(err.status).toBe(502);
  });

  it("omits status when not provided", () => {
    const err = new ProviderCallError("msg", "dns");
    expect(err.status).toBeUndefined();
  });
});

describe("NETWORK_ERROR_MESSAGES — completeness", () => {
  // 防止未来新增 category 后忘了配文案——所有 category 必须有文案
  const allCategories: ProviderErrorCategory[] = [
    "aborted",
    "timeout",
    "dns",
    "tls",
    "reset",
    "refused",
    "network",
    "http_4xx",
    "rate_limited",
    "http_5xx",
    "content_policy",
    "unknown",
  ];

  for (const category of allCategories) {
    it(`has message for ${category}`, () => {
      expect(typeof NETWORK_ERROR_MESSAGES[category]).toBe("string");
      expect(NETWORK_ERROR_MESSAGES[category].length).toBeGreaterThan(0);
    });
  }
});
