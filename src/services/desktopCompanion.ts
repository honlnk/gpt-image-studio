import { isTauriRuntime } from "../services/storage/resolveStorage";

/**
 * 桌面端（Tauri）内置 Companion 桥接（阶段四 · 方案 B 首期）。
 *
 * Rust 壳负责 sidecar 的完整生命周期（spawn / 握手 / 退出清理，见
 * desktop/src-tauri/src/lib.rs），前端只做两件事：
 * 1. 启动时通过 `desktop_companion_info` 命令拉取连接信息（有界等待），
 *    成功则由 main.ts 在 app.mount 前应用（同 qiankun applyEmbeddedConfig 的时机）；
 * 2. 管理页打开走 `open_admin_window` 命令——在应用内开原生子窗口（label 固定、
 *    重复调用聚焦）；其他外链仍走 `open_external_url`（系统浏览器）。
 *    （webview 内 window.open 被 Tauri v2 默认拦截，不可靠。）
 *
 * 拉取失败 / available=false 时模块状态保持 null，应用回落 standalone 行为
 * （可手动配对外部 Companion），桌面端不因 sidecar 故障卡死。
 *
 * `@tauri-apps/api` 走动态 import：Web 构建（GitHub Pages）不打包该依赖，
 * 只有 Tauri 运行时才加载。
 */

/** Tauri 壳注入的内置 Companion 连接信息。 */
export type DesktopCompanionConfig = {
  companionUrl: string;
  accessKey: string;
};

/** Rust `desktop_companion_info` 命令的返回形状（serde camelCase）。 */
interface DesktopCompanionInfoPayload {
  available: boolean;
  companionUrl: string;
  accessKey: string;
}

let desktopConfig: DesktopCompanionConfig | null = null;

/** 当前是否处于桌面内置 Companion 态（initDesktopCompanion 成功后为 true）。 */
export function isDesktopCompanionActive(): boolean {
  return desktopConfig !== null;
}

/** 取注入的连接配置；未激活时返回 null。 */
export function getDesktopCompanionConfig(): DesktopCompanionConfig | null {
  return desktopConfig;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("desktop_companion_info 超时")), ms),
    ),
  ]);
}

/**
 * Tauri 运行时下拉取内置 Companion 连接信息。非 Tauri 环境是 no-op。
 * 命令内部已等待 sidecar 握手（8s），这里再加外层超时兜底防 invoke 挂死。
 */
export async function initDesktopCompanion(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await withTimeout(
      invoke<DesktopCompanionInfoPayload>("desktop_companion_info"),
      15_000,
    );
    if (info?.available && info.companionUrl && info.accessKey) {
      desktopConfig = {
        companionUrl: info.companionUrl,
        accessKey: info.accessKey,
      };
    } else {
      console.warn("[desktop] 内置 Companion 不可用，按 standalone 模式运行");
    }
  } catch (err) {
    console.warn("[desktop] 拉取内置 Companion 配置失败，按 standalone 模式运行:", err);
  }
}

/**
 * 在系统浏览器打开 URL。Tauri 运行时走 opener 命令；普通浏览器退回 window.open。
 * （桌面 webview 内的 provider 管理页体验差且 window.open 被 Tauri 拦截，统一外开。）
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_external_url", { url });
}

/**
 * 打开 Companion 管理页。Tauri 运行时在应用内开原生子窗口（重复调用聚焦已有窗口）；
 * 普通浏览器退回新标签页。
 */
export async function openAdminWindow(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_admin_window", { url });
}
