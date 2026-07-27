import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStsCredentials,
  clearStsCache,
  type StsCredentials,
  type StsFetcher,
} from "./stsCredentials.js";

/**
 * stsCredentials.ts 测试（阶段三 PR4，D11）。
 *
 * 验证：缓存命中、提前续期、不同用户独立、请求头正确、宿主失败抛错。
 */

function makeSts(overrides: Partial<StsCredentials> = {}): StsCredentials {
  return {
    accessKeyId: "STS.abc123",
    accessKeySecret: "secret-1",
    securityToken: "token-1",
    expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h 后过期
    bucket: "platform-bucket",
    region: "oss-cn-hangzhou",
    prefix: "users/user-1/",
    ...overrides,
  };
}

/** 构造 mock fetcher，返回指定 STS 响应。 */
function makeFetcher(
  sts: StsCredentials,
  callCount = { value: 0 },
): StsFetcher {
  return async () => {
    callCount.value++;
    return new Response(JSON.stringify(sts), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("getStsCredentials", () => {
  beforeEach(() => {
    clearStsCache();
    process.env.MAIN_APP_URL = "https://host.example.com";
    process.env.MAIN_APP_API_KEY = "platform-key";
  });

  afterEach(() => {
    clearStsCache();
    delete process.env.MAIN_APP_URL;
    delete process.env.MAIN_APP_API_KEY;
  });

  it("首次获取调宿主接口", async () => {
    const sts = makeSts();
    const calls = { value: 0 };
    const fetcher = makeFetcher(sts, calls);
    const result = await getStsCredentials("user-1", { fetcher });
    expect(result.accessKeyId).toBe("STS.abc123");
    expect(calls.value).toBe(1);
  });

  it("缓存命中不重复调宿主", async () => {
    const sts = makeSts();
    const calls = { value: 0 };
    const fetcher = makeFetcher(sts, calls);
    await getStsCredentials("user-1", { fetcher });
    await getStsCredentials("user-1", { fetcher });
    expect(calls.value).toBe(1); // 第二次用缓存
  });

  it("不同用户独立缓存", async () => {
    const calls = { value: 0 };
    const sts1 = makeSts({ accessKeyId: "STS.user1", prefix: "users/user-1/" });
    const sts2 = makeSts({ accessKeyId: "STS.user2", prefix: "users/user-2/" });
    let current = sts1;
    const fetcher: StsFetcher = async () => {
      calls.value++;
      const toReturn = current;
      return new Response(JSON.stringify(toReturn), { status: 200 });
    };
    const r1 = await getStsCredentials("user-1", { fetcher });
    current = sts2;
    const r2 = await getStsCredentials("user-2", { fetcher });
    expect(r1.accessKeyId).toBe("STS.user1");
    expect(r2.accessKeyId).toBe("STS.user2");
    expect(calls.value).toBe(2);
  });

  it("过期前 5min 触发续期（重新调宿主）", async () => {
    // expiration 设为 4 分钟后（在 5min 续期窗口内）
    const sts = makeSts({
      expiration: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
    });
    const calls = { value: 0 };
    const fetcher = makeFetcher(sts, calls);
    await getStsCredentials("user-1", { fetcher }); // 首次
    await getStsCredentials("user-1", { fetcher }); // 续期
    expect(calls.value).toBe(2);
  });

  it("请求头带 Authorization + X-User-Id", async () => {
    const sts = makeSts();
    let capturedInit: RequestInit | null = null;
    const fetcher: StsFetcher = async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify(sts), { status: 200 });
    };
    await getStsCredentials("user-99", { fetcher });
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer platform-key");
    expect(headers["X-User-Id"]).toBe("user-99");
  });

  it("宿主返回非 200 → 抛错", async () => {
    const fetcher: StsFetcher = async () =>
      new Response("internal error", { status: 500 });
    await expect(getStsCredentials("user-1", { fetcher })).rejects.toThrow(
      /宿主 STS 签发失败/,
    );
  });

  it("宿主响应缺字段 → 抛错", async () => {
    const fetcher: StsFetcher = async () =>
      new Response(JSON.stringify({ accessKeyId: "x" }), { status: 200 });
    await expect(getStsCredentials("user-1", { fetcher })).rejects.toThrow(
      /缺少必需字段/,
    );
  });

  it("未配置 MAIN_APP_URL → 抛错", async () => {
    delete process.env.MAIN_APP_URL;
    await expect(getStsCredentials("user-1")).rejects.toThrow(
      /MAIN_APP_URL/,
    );
  });

  it("prefix 默认空字符串（宿主未限定时）", async () => {
    const sts = makeSts();
    delete (sts as Partial<StsCredentials>).prefix;
    const fetcher = makeFetcher(sts);
    const result = await getStsCredentials("user-1", { fetcher });
    expect(result.prefix).toBe("");
  });

  it("URL 拼接正确（去掉尾部斜杠）", async () => {
    process.env.MAIN_APP_URL = "https://host.example.com/";
    const sts = makeSts();
    let capturedUrl = "";
    const fetcher: StsFetcher = async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify(sts), { status: 200 });
    };
    await getStsCredentials("user-1", { fetcher });
    expect(capturedUrl).toBe("https://host.example.com/api/sts/upload-token");
  });
});
