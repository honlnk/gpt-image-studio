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

/**
 * 连接模式切换后，重建前写入此 key、重建后读取并清除，
 * 用于在重建后的工作台上显示「已切换到 xxx 模式」的成功提示。
 * sessionStorage 而非 localStorage：只在「紧邻的下一次启动」消费一次，不持久化。
 */
export const CONNECTION_MODE_SWITCHED_KEY =
  "gpt-image-studio:connection-mode-switched";
