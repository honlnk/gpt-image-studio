import { describe, expect, it, vi } from "vitest";
import { createStorageUsageServices } from "./storageUsage";
import { createSpyStorage } from "./storage/createSpyStorage";

// 容量估算（server 模式分页 PR-e）：必须走后端聚合（estimateStoredBytes），
// 不允许整库 list——Companion 模式下 list 会把 messages 等大表全量拖过网络。

describe("createStorageUsageServices", () => {
  it("estimate 走 estimateStoredBytes 聚合，不整库 list", async () => {
    const storage = createSpyStorage();
    storage.estimateStoredBytes.mockResolvedValue({
      imageBytes: 1000,
      metadataBytes: 500,
    });
    storage.estimateQuota.mockResolvedValue({ usage: 3000, quota: 10000 });

    const services = createStorageUsageServices(storage);
    const usage = await services.estimate();

    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.estimateStoredBytes).toHaveBeenCalledTimes(1);
    // metadataBytes 取 max(后端聚合, 浏览器总占用 - 图片字节)
    expect(usage).toEqual({
      imageBytes: 1000,
      metadataBytes: 2000,
      projectBytes: 3000,
      browserUsageBytes: 3000,
      quotaBytes: 10000,
    });
  });

  it("estimateQuota 未实现（Companion 模式）时缺省为空", async () => {
    const storage = createSpyStorage();
    storage.estimateStoredBytes.mockResolvedValue({
      imageBytes: 1000,
      metadataBytes: 500,
    });
    // @ts-expect-error 模拟 CompanionStorage：可选方法 estimateQuota 缺失
    storage.estimateQuota = undefined;

    const services = createStorageUsageServices(storage);
    const usage = await services.estimate();

    expect(usage.imageBytes).toBe(1000);
    expect(usage.metadataBytes).toBe(500); // 无浏览器占用时直接用后端聚合值
    expect(usage.browserUsageBytes).toBeUndefined();
    expect(usage.quotaBytes).toBeUndefined();
  });
});
