import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createSecurityConfig } from "../securityConfig.js";
import { extractBoundary, parseMultipart } from "../providers/multipart.js";
import { ProviderCallError } from "../providers/providerErrors.js";
import { errorPayload, validateEditMultipart, withClientSignal } from "./images.js";

function multipart(parts: Array<{ name: string; contentType?: string; body?: string }>): Buffer {
  const boundary = "----test-boundary";
  const content = parts.map((part) => {
    const headers = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${part.name}"; filename="${part.name}.bin"`,
    part.contentType ? `Content-Type: ${part.contentType}` : undefined,
    ].filter(Boolean);
    return `${headers.join("\r\n")}\r\n\r\n${part.body ?? "data"}`;
  }).join("\r\n")
    + `\r\n--${boundary}--\r\n`;

  return Buffer.from(content, "latin1");
}

function validateMultipart(
  body: Buffer,
  security = createSecurityConfig({ channel: "dev" }),
): string | null {
  const boundary = extractBoundary("multipart/form-data; boundary=----test-boundary");
  if (!boundary) throw new Error("test boundary missing");
  const parsed = parseMultipart(body, boundary);
  if ("message" in parsed) return parsed.message;
  return validateEditMultipart(parsed, security);
}

describe("companion image route validation", () => {
  const security = createSecurityConfig({ channel: "dev" });

  it("accepts image references and png mask", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toBeNull();
  });

  it("requires at least one image", () => {
    const body = multipart([
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("至少需要一张引用图片");
  });

  it("rejects too many image references", () => {
    const body = multipart(Array.from({ length: 17 }, () => ({
      name: "image[]",
      contentType: "image/png",
    })));

    expect(validateMultipart(body, security)).toContain("最多支持 16 张引用图片");
  });

  it("rejects unsupported image mime types", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/gif" },
    ]);

    expect(validateMultipart(body, security)).toContain("不支持的图片类型");
  });

  it("requires mask to be png", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/jpeg" },
    ]);

    expect(validateMultipart(body, security)).toContain("mask 必须是 image/png");
  });

  it("rejects unknown file fields during structured parsing", () => {
    const body = multipart([
      { name: "reference", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("不支持的文件字段");
  });

  it("rejects empty image files", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png", body: "" },
    ]);

    expect(validateMultipart(body, security)).toContain("不能为空");
  });

  it("rejects image parts without Content-Type", () => {
    const body = multipart([
      { name: "image[]", body: "png" },
    ]);

    expect(validateMultipart(body, security)).toContain("缺少 Content-Type");
  });

  it("rejects a duplicate mask", () => {
    const body = multipart([
      { name: "image[]", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
      { name: "mask", contentType: "image/png" },
    ]);

    expect(validateMultipart(body, security)).toContain("mask 只能有一个");
  });

});

/**
 * withClientSignal 单元测试：验证浏览器断开时 AbortController.abort() 被触发，
 * 让 signal 一路传到 provider fetch；正常完成时不应误触发 abort。
 *
 * 用 EventEmitter 模拟 req.raw.socket（Node Socket 是 EventEmitter 子类），
 * 用可变对象模拟 reply.raw.writableEnded。真实场景下 socket 的 'close' 只在
 * 底层连接关闭时触发（keep-alive 复用时不触发），`req.raw` 的 'close' 则会在
 * 请求体读完后就触发——后者会导致正常 async 请求被误判为取消。
 */
type MockSocket = EventEmitter;
type MockReq = { raw: { socket: MockSocket } };
type MockReply = { raw: { writableEnded: boolean } };

function makeMocks(): { req: MockReq; reply: MockReply } {
  return {
    req: { raw: { socket: new EventEmitter() } },
    reply: { raw: { writableEnded: false } },
  };
}

describe("withClientSignal — abort propagation", () => {
  it("aborts the signal when client disconnects mid-request", async () => {
    const { req, reply } = makeMocks();
    let signalReceived: AbortSignal | undefined;
    const pending = withClientSignal(req as never, reply as never, async (signal) => {
      signalReceived = signal;
      // 阻塞直到外部 emit close（模拟客户端断开，socket 关闭）
      return new Promise<string>((resolve) => {
        signal.addEventListener("abort", () => resolve("aborted"), { once: true });
      });
    });
    // 让 fn 进入执行（setImmediate 让出当前 microtask）
    await new Promise((r) => setImmediate(r));
    expect(signalReceived).toBeDefined();
    expect(signalReceived!.aborted).toBe(false);

    // 模拟 socket 关闭（客户端断开）
    req.raw.socket.emit("close");
    const result = await pending;
    expect(result).toBe("aborted");
    expect(signalReceived!.aborted).toBe(true);
  });

  it("does NOT abort when async fn completes before socket closes", async () => {
    // 回归守护：真实场景下 provider 调用是 async 的（fetch 需要时间），
    // fn 正常 resolve 后 finally 会 off 掉 listener，之后 socket close 不应再 abort。
    const { req, reply } = makeMocks();
    let signalAborted = false;
    const result = await withClientSignal(req as never, reply as never, async (signal) => {
      signal.addEventListener("abort", () => { signalAborted = true; });
      // 模拟 provider 调用（有延迟但正常完成）
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    });
    expect(result).toBe("ok");
    expect(signalAborted).toBe(false);
    // fn 完成后 listener 已被 off，模拟连接关闭不应再触发 abort
    req.raw.socket.emit("close");
    expect(signalAborted).toBe(false);
  });

  it("does not abort if response already written when socket closes", async () => {
    const { req, reply } = makeMocks();
    let signalAborted = false;
    const pending = withClientSignal(req as never, reply as never, async (signal) => {
      signal.addEventListener("abort", () => { signalAborted = true; });
      // 模拟 reply 已完整写出（writableEnded=true）后 socket 才 close
      reply.raw.writableEnded = true;
      req.raw.socket.emit("close");
      return new Promise<string>((resolve) => {
        // 给 abort handler 一个机会运行（不会运行）
        setTimeout(() => resolve("done"), 5);
      });
    });
    const result = await pending;
    expect(result).toBe("done");
    expect(signalAborted).toBe(false);
  });

  it("removes the socket close listener after completion (no EventEmitter leak)", async () => {
    const { req, reply } = makeMocks();
    await withClientSignal(req as never, reply as never, async () => "ok");
    // 完成后 listener 应被 off，剩余 close listener 数为 0
    expect(req.raw.socket.listenerCount("close")).toBe(0);
  });
});

describe("errorPayload — response body shape", () => {
  it("includes category for ProviderCallError", () => {
    const err = new ProviderCallError("dns 解析失败", "dns");
    expect(errorPayload(err)).toEqual({
      error: "dns 解析失败",
      category: "dns",
    });
  });

  it("omits category for plain Error", () => {
    expect(errorPayload(new Error("boom"))).toEqual({ error: "boom" });
  });

  it("falls back to 未知错误 for non-Error", () => {
    expect(errorPayload("just a string")).toEqual({ error: "未知错误" });
  });

  it("falls back to 未知错误 when Error has empty message", () => {
    expect(errorPayload(new Error(""))).toEqual({ error: "未知错误" });
  });
});
