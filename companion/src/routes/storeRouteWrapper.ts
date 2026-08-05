import type { FastifyReply } from "fastify";
import { CredentialStoreError } from "../credentials.js";

/**
 * 把 CredentialStoreError 转成 500 + { error, corrupt: true } 响应。
 *
 * 凭据文件损坏时 loadStore 抛 CredentialStoreError（已备份损坏文件并给出可读文案）；
 * 这里在 route 边界兜底一次，让 Web 端 credError 通道能展示具体原因。
 * 非 CredentialStoreError 重新抛出，交给 Fastify 默认错误处理器。
 *
 * 返回值用 `as never` 绕过 Fastify 的 Reply 类型约束——和现有 400 错误响应的
 * `{ error } as never` 同一模式：错误响应的 shape 不在正常 Reply 类型里。
 */
export function handleStoreError(error: unknown, reply: FastifyReply): never {
  if (error instanceof CredentialStoreError) {
    return reply.status(500).send({ error: error.message, corrupt: true }) as never;
  }
  throw error;
}

/**
 * 在 CredentialStore 错误边界里执行 handler。
 *
 * 把 credentials 路由里重复的
 *   try { ... } catch (e) { return handleStoreError(e, reply); }
 * 收敛成一个高阶函数。`reply` 透传给 handleStoreError。
 */
export async function withStoreErrorBoundary<T>(
  reply: FastifyReply,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return handleStoreError(error, reply) as unknown as Promise<T>;
  }
}
