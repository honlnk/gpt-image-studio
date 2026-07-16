import { describe, expect, it, vi } from "vitest";
import type {
  ImageDownloadResponse,
  ImageRequest,
} from "./urlToB64.js";
import { urlToB64 } from "./urlToB64.js";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const WEBP = Buffer.from("RIFF0000WEBPpayload", "ascii");

describe("urlToB64", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/webp", WEBP],
  ])("accepts a valid %s response", async (contentType, bytes) => {
    const requestImpl = makeRequest(response(bytes, {
      "content-type": contentType,
      "content-length": String(bytes.length),
    }));

    await expect(download(requestImpl)).resolves.toBe(bytes.toString("base64"));
  });

  it.each([
    "http://example.com/image.png",
    "file:///tmp/image.png",
    "data:image/png;base64,AA==",
  ])("rejects non-HTTPS URL without making a request: %s", async (url) => {
    const requestImpl = makeRequest(response(PNG));

    await expect(download(requestImpl, url)).rejects.toThrow(/只允许使用 HTTPS/);
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("rejects URL credentials", async () => {
    const requestImpl = makeRequest(response(PNG));

    await expect(
      download(requestImpl, "https://user:secret@example.com/image.png"),
    ).rejects.toThrow(/不能包含用户名或密码/);
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{}, /缺少 Content-Type/],
    [{ "content-type": "text/html" }, /不是受支持的图片类型/],
    [{ "content-type": "image/gif" }, /不是受支持的图片类型/],
    [{ "content-type": "image/png", "content-encoding": "gzip" }, /不支持压缩/],
  ])("rejects unsafe response headers", async (headers, message) => {
    const downloadResponse = response(PNG, headers);

    await expect(download(makeRequest(downloadResponse))).rejects.toThrow(message);
    expect(downloadResponse.destroy).toHaveBeenCalledOnce();
  });

  it("rejects HTML disguised as PNG", async () => {
    const downloadResponse = response(Buffer.from("<html>nope</html>"), {
      "content-type": "image/png",
    });

    await expect(download(makeRequest(downloadResponse))).rejects.toThrow(
      /内容与 Content-Type image\/png 不匹配/,
    );
    expect(downloadResponse.destroy).toHaveBeenCalledOnce();
  });

  it("rejects a MIME and image signature mismatch", async () => {
    await expect(
      download(makeRequest(response(JPEG, { "content-type": "image/png" }))),
    ).rejects.toThrow(/内容与 Content-Type image\/png 不匹配/);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const downloadResponse = response(PNG, {
      "content-type": "image/png",
      "content-length": "10",
    });

    await expect(download(makeRequest(downloadResponse), undefined, {
      maxBytes: 9,
    })).rejects.toThrow(/超过大小上限/);
    expect(downloadResponse.destroy).toHaveBeenCalledOnce();
  });

  it("stops a streamed body as soon as it exceeds the byte limit", async () => {
    const downloadResponse = response([PNG.subarray(0, 8), Buffer.from([1, 2])], {
      "content-type": "image/png",
    });

    await expect(download(makeRequest(downloadResponse), undefined, {
      maxBytes: 9,
    })).rejects.toThrow(/超过大小上限/);
    expect(downloadResponse.destroy).toHaveBeenCalled();
  });

  it("rejects an empty image response", async () => {
    const downloadResponse = response(Buffer.alloc(0), {
      "content-type": "image/png",
    });

    await expect(download(makeRequest(downloadResponse))).rejects.toThrow(/内容为空/);
    expect(downloadResponse.destroy).toHaveBeenCalledOnce();
  });

  it("follows a relative redirect and validates the final response", async () => {
    const requestImpl = vi
      .fn<ImageRequest>()
      .mockResolvedValueOnce(response(Buffer.alloc(0), {
        location: "/final.png",
      }, 302))
      .mockResolvedValueOnce(response(PNG, { "content-type": "image/png" }));

    await expect(download(requestImpl)).resolves.toBe(PNG.toString("base64"));
    expect(requestImpl.mock.calls.map(([url]) => url.href)).toEqual([
      "https://example.com/image.png",
      "https://example.com/final.png",
    ]);
  });

  it("rejects a redirect to a private address before requesting it", async () => {
    const requestImpl = makeRequest(response(Buffer.alloc(0), {
      location: "https://127.0.0.1/image.png",
    }, 302));

    await expect(download(requestImpl)).rejects.toThrow(/非公网 IP/);
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("rejects redirect loops", async () => {
    const requestImpl = makeRequest(response(Buffer.alloc(0), {
      location: "/image.png",
    }, 302));

    await expect(download(requestImpl)).rejects.toThrow(/重定向循环/);
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("enforces the redirect limit", async () => {
    const requestImpl = vi
      .fn<ImageRequest>()
      .mockResolvedValueOnce(response(Buffer.alloc(0), {
        location: "/one.png",
      }, 302))
      .mockResolvedValueOnce(response(Buffer.alloc(0), {
        location: "/two.png",
      }, 302));

    await expect(download(requestImpl, undefined, {
      maxRedirects: 1,
    })).rejects.toThrow(/重定向次数超过上限 1/);
    expect(requestImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a normal 4xx response", async () => {
    const requestImpl = makeRequest(response(Buffer.alloc(0), {}, 404));

    await expect(download(requestImpl, undefined, { retries: 2 })).rejects.toThrow(
      /HTTP 404/,
    );
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("retries a 5xx response and succeeds", async () => {
    vi.useFakeTimers();
    try {
      const requestImpl = vi
        .fn<ImageRequest>()
        .mockResolvedValueOnce(response(Buffer.alloc(0), {}, 503))
        .mockResolvedValueOnce(response(PNG, { "content-type": "image/png" }));
      const result = download(requestImpl, undefined, { retries: 1 });

      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe(PNG.toString("base64"));
      expect(requestImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a network failure and reports exhaustion", async () => {
    vi.useFakeTimers();
    try {
      const networkError = Object.assign(new Error("socket reset"), {
        code: "ECONNRESET",
      });
      const requestImpl = vi.fn<ImageRequest>().mockRejectedValue(networkError);
      const result = download(requestImpl, undefined, { retries: 1 });
      const assertion = expect(result).rejects.toThrow(/已重试 1 次.*socket reset/);

      await vi.runAllTimersAsync();

      await assertion;
      expect(requestImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a policy failure", async () => {
    const requestImpl = makeRequest(response(Buffer.from("not png"), {
      "content-type": "image/png",
    }));

    await expect(download(requestImpl, undefined, { retries: 2 })).rejects.toThrow(
      /内容与 Content-Type/,
    );
    expect(requestImpl).toHaveBeenCalledOnce();
  });

  it("does not retry a non-transient TLS failure", async () => {
    const tlsError = Object.assign(new Error("certificate expired"), {
      code: "CERT_HAS_EXPIRED",
    });
    const requestImpl = vi.fn<ImageRequest>().mockRejectedValue(tlsError);

    await expect(download(requestImpl, undefined, { retries: 2 })).rejects.toThrow(
      /certificate expired/,
    );
    expect(requestImpl).toHaveBeenCalledOnce();
  });
});

function download(
  requestImpl: ImageRequest,
  url = "https://example.com/image.png",
  options: {
    retries?: number;
    maxBytes?: number;
    maxRedirects?: number;
  } = {},
): Promise<string> {
  return urlToB64(url, {
    retries: options.retries ?? 0,
    maxBytes: options.maxBytes,
    maxRedirects: options.maxRedirects,
    requestImpl,
  });
}

function makeRequest(downloadResponse: ImageDownloadResponse): ReturnType<typeof vi.fn<ImageRequest>> {
  return vi.fn<ImageRequest>().mockResolvedValue(downloadResponse);
}

function response(
  body: Buffer | Buffer[],
  headers: ImageDownloadResponse["headers"] = { "content-type": "image/png" },
  statusCode = 200,
): ImageDownloadResponse {
  const chunks = Array.isArray(body) ? body : [body];
  return {
    statusCode,
    headers,
    body: (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })(),
    destroy: vi.fn(),
  };
}
