/**
 * StudioStorage 抽象层 barrel export。
 *
 * 这是前端业务代码访问存储后端的唯一入口（约束 D5）。
 * 阶段一 PR1 只建立模块，业务代码暂不切换（PR2-6 逐步迁移）。
 */
export {
  STORE_NAMES,
  StorageError,
  type ImageBlobRecord,
  type StorageBackend,
  type StoreName,
  type StudioStorage,
} from "./types";

export { IndexedDbStorage } from "./IndexedDbStorage";
export { CompanionStorage } from "./CompanionStorage";
export { NativeStorage } from "./NativeStorage";
export { InMemoryStorage } from "./InMemoryStorage";
export { isTauriRuntime, resolveStorage } from "./resolveStorage";
