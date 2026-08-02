/**
 * resolvePublicAssetUrl：嵌入态（qiankun）下 public 静态资源的 URL 解析。
 *
 * 回归：嵌入态下 /favicon.svg 会按宿主 origin 解析 → 404（logo 加载不出来）。
 * 需要用 qiankun 注入的 __INJECTED_PUBLIC_PATH_BY_QIANKUN__ 拼出子应用源完整 URL。
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolvePublicAssetUrl } from "./publicAssets";

// 测试在 node 环境运行（无 window）：用 globalThis 垫一个最小 window 桩
const winStub = {} as Record<string, unknown>;
const hadWindow = typeof (globalThis as Record<string, unknown>).window !== "undefined";
if (!hadWindow) {
  (globalThis as Record<string, unknown>).window = winStub;
}

afterEach(() => {
  delete winStub["__POWERED_BY_QIANKUN__"];
  delete winStub["__INJECTED_PUBLIC_PATH_BY_QIANKUN__"];
});

describe("resolvePublicAssetUrl", () => {
  it("独立态原样返回路径", () => {
    expect(resolvePublicAssetUrl("/favicon.svg")).toBe("/favicon.svg");
  });

  it("嵌入态用 qiankun 注入的 publicPath 拼出子应用源完整 URL", () => {
    winStub["__POWERED_BY_QIANKUN__"] = true;
    winStub["__INJECTED_PUBLIC_PATH_BY_QIANKUN__"] = "http://127.0.0.1:4173/";

    expect(resolvePublicAssetUrl("/favicon.svg")).toBe(
      "http://127.0.0.1:4173/favicon.svg",
    );
  });

  it("嵌入态但 publicPath 缺失时降级为原路径", () => {
    winStub["__POWERED_BY_QIANKUN__"] = true;
    expect(resolvePublicAssetUrl("/favicon.svg")).toBe("/favicon.svg");
  });
});
