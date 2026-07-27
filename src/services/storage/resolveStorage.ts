/**
 * 运行时检测与 storage 工厂。
 *
 * 阶段一（本文件当前形态）：
 * - isTauriRuntime() 只检测、不切换（预留阶段四）。
 * - resolveStorage() 永远返回 IndexedDbStorage，与路线图"第一阶段永远返回 IndexedDbStorage"一致。
 *
 * 阶段二扩展（届时取消注释）：
 * - connectionMode === "localCompanion" → CompanionStorage。
 *
 * 阶段四扩展（届时取消注释）：
 * - isTauriRuntime() → NativeStorage。
 *
 * 关键原则：resolveStorage() 是整个应用唯一的 storage 实例化点。
 * 所有 service 工厂共享同一个 storage 实例（PR4 在 useStudioViewModel 装配）。
 */
import { IndexedDbStorage } from "./IndexedDbStorage";
import type { StudioStorage } from "./types";

/** 运行时检测：是否在 Tauri webview 内。阶段一仅检测不切换，预留阶段四。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 阶段一永远返回 IndexedDbStorage。
 *
 * 阶段二会扩展为：connectionMode === "localCompanion" → CompanionStorage。
 * 阶段四会扩展为：isTauriRuntime() → NativeStorage。
 *
 * 注：阶段二的 connectionMode 参数在此预留，阶段一不需要。
 */
export function resolveStorage(): StudioStorage {
  return new IndexedDbStorage();
}
