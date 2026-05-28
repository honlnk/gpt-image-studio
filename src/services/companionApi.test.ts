import { afterEach, describe, expect, it, vi } from "vitest";
import { getCompanionAuthStatusResult } from "./companionApi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("companion API", () => {
  it("marks 401 auth status responses as invalid tokens", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "未授权：token 无效" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      getCompanionAuthStatusResult("http://127.0.0.1:19750", "stale-token"),
    ).resolves.toEqual({ ok: false, invalidToken: true });
  });

  it("returns auth status when the token is accepted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        provider: "openai",
        mode: "api_key",
        ready: true,
        accountLabel: "sk-test***",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      getCompanionAuthStatusResult("http://127.0.0.1:19750", "valid-token"),
    ).resolves.toEqual({
      ok: true,
      status: {
        provider: "openai",
        mode: "api_key",
        ready: true,
        accountLabel: "sk-test***",
      },
    });
  });
});
