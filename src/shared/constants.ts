/**
 * Web 端共享常量。
 *
 * 这里只放"跨多个模块共同使用的字面量"——单一文件内部使用的私有常量
 * 不必搬来。Companion 服务端的常量不在此处（companion 有自己的
 * `constants`/`securityConfig`）。
 */

/** Companion 默认监听端口。与 `companion/src/main.ts` 的 DEFAULT_PORT 对齐。 */
export const COMPANION_DEFAULT_PORT = 19750;

/** Companion 默认 URL。 */
export const COMPANION_DEFAULT_URL = `http://127.0.0.1:${COMPANION_DEFAULT_PORT}`;

/** 健康检查 / auth 状态探测的请求超时（毫秒）。 */
export const COMPANION_HEALTH_TIMEOUT_MS = 3000;
