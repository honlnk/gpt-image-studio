/// <reference types="vite/client" />

// 阶段三 PR5：qiankun 嵌入态全局标志（qiankun 在子应用 entry 执行前注入）。
interface Window {
  /** qiankun 注入：true 表示当前运行在 qiankun 子应用容器内。 */
  __POWERED_BY_QIANKUN__?: boolean
  /** qiankun 注入的运行时 public path（资源加载用）。 */
  __INJECTED_PUBLIC_PATH__?: string
}
