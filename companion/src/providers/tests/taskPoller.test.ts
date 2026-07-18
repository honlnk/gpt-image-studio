import { describe, expect, it, vi } from "vitest";
import { runAsyncTask } from "../taskPoller.js";

function makeResult() {
  return { b64Json: "Z29vZC1pbWFnZQ==", revisedPrompt: undefined };
}

describe("runAsyncTask", () => {
  it("returns result when first poll succeeds", async () => {
    const submit = vi.fn().mockResolvedValue({ taskId: "t1" });
    const poll = vi.fn().mockResolvedValue("SUCCESS" as const);
    const extractResult = vi.fn().mockResolvedValue(makeResult());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runAsyncTask({
      submit,
      poll,
      extractResult,
      intervalMs: 10,
      timeoutMs: 1000,
      sleep,
    });

    expect(result).toEqual(makeResult());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(extractResult).toHaveBeenCalledWith("t1");
    // 成功后不应再 sleep
    expect(sleep).not.toHaveBeenCalled();
  });

  it("polls on PENDING until SUCCESS", async () => {
    const submit = vi.fn().mockResolvedValue({ taskId: "t2" });
    const poll = vi
      .fn()
      .mockResolvedValueOnce("PENDING" as const)
      .mockResolvedValueOnce("PENDING" as const)
      .mockResolvedValueOnce("SUCCESS" as const);
    const extractResult = vi.fn().mockResolvedValue(makeResult());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runAsyncTask({
      submit,
      poll,
      extractResult,
      intervalMs: 5,
      timeoutMs: 1000,
      sleep,
    });

    expect(result).toEqual(makeResult());
    expect(poll).toHaveBeenCalledTimes(3);
    // 两次 PENDING → 两次 sleep
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 5);
    expect(sleep).toHaveBeenNthCalledWith(2, 5);
  });

  it("rejects when task FAILED", async () => {
    const submit = vi.fn().mockResolvedValue({ taskId: "t3" });
    const poll = vi.fn().mockResolvedValue("FAILED" as const);
    const extractResult = vi.fn();

    await expect(
      runAsyncTask({
        submit,
        poll,
        extractResult,
        intervalMs: 10,
        timeoutMs: 1000,
        sleep: vi.fn(),
      }),
    ).rejects.toThrow(/失败/);
    expect(extractResult).not.toHaveBeenCalled();
  });

  it("rejects on timeout when never reaching terminal state", async () => {
    const submit = vi.fn().mockResolvedValue({ taskId: "t4" });
    const poll = vi.fn().mockResolvedValue("PENDING" as const);
    const extractResult = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);

    // 固定 Date.now 序列：起点 1000，之后每次判断都返回 1000（不超时），
    // 用真实 Date.now 走真实流逝，配合极小 timeoutMs 保证触发。
    await expect(
      runAsyncTask({
        submit,
        poll,
        extractResult,
        intervalMs: 1,
        timeoutMs: 0, // 立即超时
        sleep,
      }),
    ).rejects.toThrow(/超时/);
  });

  it("rethrows when poll throws a network error", async () => {
    const submit = vi.fn().mockResolvedValue({ taskId: "t5" });
    const poll = vi.fn().mockRejectedValue(new Error("connection reset"));
    const extractResult = vi.fn();

    await expect(
      runAsyncTask({
        submit,
        poll,
        extractResult,
        intervalMs: 10,
        timeoutMs: 1000,
        sleep: vi.fn(),
      }),
    ).rejects.toThrow(/轮询失败.*connection reset/);
  });
});
