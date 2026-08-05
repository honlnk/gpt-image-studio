import { type StudioStorage } from "./storage";

export type StorageUsage = {
  imageBytes: number;
  metadataBytes: number;
  projectBytes: number;
  browserUsageBytes?: number;
  quotaBytes?: number;
};

/** 容量估算服务。阶段一 PR3 改工厂注入（决策 T1）。 */
export type StorageUsageServices = ReturnType<
  typeof createStorageUsageServices
>;

export function createStorageUsageServices(storage: StudioStorage) {
  return {
    /**
     * 容量估算（server 模式分页 PR-e）：委托存储后端的 estimateStoredBytes 聚合，
     * 不再整库拉取 6 张表在客户端求和——Companion 实现走 /storage/usage
     * 服务端 SQL 聚合，messages 表再大也不会把全量数据拖过网络。
     * IndexedDB 实现仍是本地全量求和（本地磁盘，毫秒级，无网络成本）。
     */
    async estimate(): Promise<StorageUsage> {
      const [stored, browserEstimate] = await Promise.all([
        storage.estimateStoredBytes(),
        // 可选方法：仅本地 IndexedDB 实现提供（浏览器 quota 概念），
        // Companion 模式数据在服务端，无浏览器 quota 语义。
        storage.estimateQuota?.() ??
          Promise.resolve<{ usage?: number; quota?: number }>({}),
      ]);

      const imageBytes = stored.imageBytes;
      const browserUsageBytes = browserEstimate.usage;
      // browser 总占用（含 IndexedDB 页开销等）通常大于 JSON 序列化体积，
      // 取大者更接近用户感知的"占了浏览器多少空间"。
      const metadataBytes = Math.max(
        stored.metadataBytes,
        browserUsageBytes ? browserUsageBytes - imageBytes : 0,
      );

      return {
        imageBytes,
        metadataBytes,
        projectBytes: imageBytes + metadataBytes,
        browserUsageBytes,
        quotaBytes: browserEstimate.quota,
      };
    },
  };
}
