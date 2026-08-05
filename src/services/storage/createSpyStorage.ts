/**
 * 测试辅助：创建带 vi.fn spy 的 StudioStorage mock。
 *
 * 用于 service 层测试，验证 service 正确委托 storage 接口（而非验证它调用
 * db.ts 的具体函数——阶段一后存储后端抽象变了，测试断言目标也跟着变）。
 *
 * 行为：每个方法都是 vi.fn()，默认返回值模拟"空存储"（list 返回 []、
 * get 返回 undefined 等）。测试用 mockResolvedValue 注入数据。
 */
import { vi } from "vitest";
import { STORE_NAMES, type StudioStorage } from "./types";

export type SpyStorage = StudioStorage & {
  // 让每个方法都是 vi.Mock，测试里可断言调用次数/参数。
  list: ReturnType<typeof vi.fn>;
  listPage: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  saveImageBlob: ReturnType<typeof vi.fn>;
  loadImageBlob: ReturnType<typeof vi.fn>;
  deleteImageBlob: ReturnType<typeof vi.fn>;
  readConfig: ReturnType<typeof vi.fn>;
  writeConfig: ReturnType<typeof vi.fn>;
  estimateStoredBytes: ReturnType<typeof vi.fn>;
  estimateQuota: ReturnType<typeof vi.fn>;
};

export function createSpyStorage(): SpyStorage {
  return {
    backend: "indexeddb",
    list: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ data: [], nextCursor: null, total: 0 }),
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    saveImageBlob: vi.fn().mockResolvedValue(undefined),
    loadImageBlob: vi.fn().mockResolvedValue(undefined),
    deleteImageBlob: vi.fn().mockResolvedValue(undefined),
    readConfig: vi.fn().mockResolvedValue(undefined),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    estimateStoredBytes: vi
      .fn()
      .mockResolvedValue({ imageBytes: 0, metadataBytes: 0 }),
    estimateQuota: vi.fn().mockResolvedValue({}),
  };
}

/** STORE_NAMES 从 storage 层导出，测试里直接用（不再依赖 db.ts）。 */
export { STORE_NAMES };
