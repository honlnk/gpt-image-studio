import type { OpenAIImageResult } from "./types.js";

/**
 * 异步任务的终端状态。
 * - SUCCESS：任务完成，可以取结果。
 * - FAILED：任务失败（审核驳回、参数错误等），永久终态。
 * - PENDING：仍在进行中，继续轮询。
 */
export type TaskStatus = "PENDING" | "SUCCESS" | "FAILED";

/** 任务失败时携带的可读原因（来自上游错误信息），用于抛给调用方。 */
export type TaskPollError = {
  status: "FAILED";
  message: string;
};

/**
 * 通用异步任务轮询器。把异步 provider 的「提交 task → 轮询状态 → 取结果」
 * 三步包成一个同步 await 的 Promise。
 *
 * 适用场景：通义万相 Wan、GLM 异步接口等「提交即返回 task_id、断开连接、
 * 客户端反复查询」的模式。本轮 GLM 走同步接口，不调用本工具，
 * 但先实现并测好，阶段四接异步 provider 时直接 `await runAsyncTask({...})`。
 *
 * 行为约定：
 * - 提交后立即进入轮询循环，间隔 intervalMs 查一次状态。
 * - 状态 SUCCESS → 调 extractResult 取结果 resolve。
 * - 状态 FAILED → reject 一个带 message 的 Error。
 * - 超过 timeoutMs 仍未终态 → reject 一个超时错误。
 * - poll/extractResult 抛错（网络异常等）→ reject 原错误。
 */
export async function runAsyncTask(options: {
  /** 提交任务，返回 task_id。 */
  submit: () => Promise<{ taskId: string }>;
  /** 查询任务状态。仅返回 PENDING/SUCCESS/FAILED，不取结果。 */
  poll: (taskId: string) => Promise<TaskStatus>;
  /** 任务进入 SUCCESS 后取最终结果。 */
  extractResult: (taskId: string) => Promise<OpenAIImageResult>;
  /** 轮询间隔（毫秒）。 */
  intervalMs: number;
  /** 总超时（毫秒），从首次提交后开始计时。 */
  timeoutMs: number;
  /** 可选的睡眠函数注入点，测试用。默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
}): Promise<OpenAIImageResult> {
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  const { taskId } = await options.submit();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error(
        `异步任务 ${taskId} 超时（>${options.timeoutMs}ms 仍未完成）`,
      );
    }

    let status: TaskStatus;
    try {
      status = await options.poll(taskId);
    } catch (error) {
      throw new Error(
        `异步任务 ${taskId} 轮询失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (status === "SUCCESS") {
      return await options.extractResult(taskId);
    }
    if (status === "FAILED") {
      throw new Error(`异步任务 ${taskId} 失败`);
    }

    await sleep(options.intervalMs);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
