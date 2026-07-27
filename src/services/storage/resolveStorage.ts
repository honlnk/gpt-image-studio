/**
 * 运行时检测与 storage 工厂。
 *
 * 阶段一：恒返回 IndexedDbStorage。
 * 阶段二（当前）：connectionMode === "localCompanion" → CompanionStorage。
 * 阶段四（预留）：isTauriRuntime() → NativeStorage。
 *
 * 关键原则：resolveStorage() 是整个应用唯一的 storage 实例化点。
 * 所有 service 工厂共享同一个 storage 实例（在 useStudioViewModel 装配）。
 *
 * 装配顺序（useStudioViewModel）：
 * 1. 先创建 settingsStore（拿到 companionUrl/companionAccessKey/connectionMode 的 ref）。
 * 2. 调 resolveStorage 传入 getters（闭包持有 ref，每次 fetch 惰性读取）。
 * 3. 用返回的 storage 实例创建 service 工厂，注入到各 store。
 *
 * 兜底调用（无参 resolveStorage()）仍返回 IndexedDbStorage，
 * 保证早期调用（settingsStore 内部默认 service、service 模块默认实例）行为不变。
 */
import { IndexedDbStorage } from "./IndexedDbStorage";
import { CompanionStorage } from "./CompanionStorage";
import type { StudioStorage } from "./types";
import type { ConnectionMode } from "../../types/studio";

/** 运行时检测：是否在 Tauri webview 内。阶段四预留。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ResolveStorageOptions = {
  /** 连接模式。localCompanion → CompanionStorage；其它 → IndexedDbStorage。 */
  connectionMode?: ConnectionMode;
  /** Companion 服务地址 getter（CompanionStorage 用，惰性读取）。 */
  getCompanionUrl?: () => string;
  /** Companion 连接密钥 getter（CompanionStorage 用，惰性读取）。 */
  getCompanionAccessKey?: () => string;
};

/**
 * 按运行时 + connectionMode 装配 storage 实例。
 *
 * 无参调用（兜底）恒返回 IndexedDbStorage——保证早期调用（settingsStore 默认 service、
 * service 模块默认实例）在 hydrate 前走 IndexedDB，行为与阶段一一致。
 *
 * ViewModel 在 settingsStore 创建后，传入 connectionMode + getters，正确分叉。
 */
export function resolveStorage(opts?: ResolveStorageOptions): StudioStorage {
  // 阶段二：localCompanion 模式用 CompanionStorage
  if (
    opts?.connectionMode === "localCompanion" &&
    opts.getCompanionUrl &&
    opts.getCompanionAccessKey
  ) {
    return new CompanionStorage({
      getCompanionUrl: opts.getCompanionUrl,
      getCompanionAccessKey: opts.getCompanionAccessKey,
    });
  }
  // direct 模式 + 兜底：IndexedDbStorage
  return new IndexedDbStorage();
}
