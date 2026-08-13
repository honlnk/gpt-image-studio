import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useImagesStore } from "./imagesStore";
import { IMAGE_ASSETS_PAGE_SIZE } from "./imagesStore";
import { createImageAssetServices } from "../services/imageAssets";
import {
  createSpyStorage,
  type SpyStorage,
} from "../services/storage/createSpyStorage";
import { InMemoryStorage } from "../services/storage/InMemoryStorage";
import { STORE_NAMES } from "../services/storage";
import { createStorageUsageServices } from "../services/storageUsage";
import { useFeedbackStore } from "./feedbackStore";
import type { ImageAsset } from "../types/studio";

// imagesStore 的预览懒加载（PR9）：hydrate 只装配 metadata，blob 走
// 优先级队列按需加载。node 环境没有 URL.createObjectURL / Image，
// 这里 stub objectURL；测试资产都带 width/height，跳过 readImageDimensions 分支。

let objectUrlSeq = 0;

beforeEach(() => {
  setActivePinia(createPinia());
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(
    () => `blob:mock-${++objectUrlSeq}`,
  );
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});

function makeAsset(
  id: string,
  conversationId = "conv-1",
  createdAt = "2026-08-01T00:00:00.000Z",
): ImageAsset {
  return {
    id,
    blobKey: `blob-${id}`,
    name: id,
    source: "generated",
    mimeType: "image/png",
    width: 100,
    height: 100,
    conversationId,
    prompt: "",
    createdAt,
    updatedAt: createdAt,
  };
}

function setup(activeConversationIdValue = "conv-1") {
  const storage = createSpyStorage();
  const store = useImagesStore();
  const activeConversationId = ref(activeConversationIdValue);
  store.configureImagesStore({
    services: {
      imageAssets: createImageAssetServices(storage),
      storageUsage: createStorageUsageServices(storage),
    },
    activeConversationId,
    messages: ref([]),
    onStorageError: vi.fn(),
  });
  return { store, storage, activeConversationId };
}

/** 走真实分页语义的变体：InMemoryStorage 支持 put/listPage，spy 则全是空 mock。 */
function setupWithMemoryStorage(activeConversationIdValue = "conv-1") {
  const storage = new InMemoryStorage();
  const store = useImagesStore();
  const activeConversationId = ref(activeConversationIdValue);
  store.configureImagesStore({
    services: {
      imageAssets: createImageAssetServices(storage),
      storageUsage: createStorageUsageServices(storage),
    },
    activeConversationId,
    messages: ref([]),
    onStorageError: vi.fn(),
  });
  return { store, storage, activeConversationId };
}

/** 把 loadImageBlob 挂成手动放行，返回开始加载的 key 顺序与放行函数。 */
function gateLoads(storage: SpyStorage) {
  const startedKeys: string[] = [];
  const pending: Array<() => void> = [];
  storage.loadImageBlob.mockImplementation(
    (key: string) =>
      new Promise<Blob>((resolve) => {
        startedKeys.push(key);
        pending.push(() => resolve(new Blob(["x"], { type: "image/png" })));
      }),
  );
  return { startedKeys, releaseNext: () => pending.shift()?.() };
}

async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe("imagesStore 预览懒加载（PR9）", () => {
  // PR-c 起 hydrateImagePreviews 被移除：恢复编排改由 ensureConversationAssets
  // 负责（按需拉取当前会话图片元数据 + 插队加载）。这两个用例换用
  // InMemoryStorage 走真实分页路径，验证同一行为契约。
  it("ensureConversationAssets 只拉取并自动加载目标会话的图片", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await storage.put(STORE_NAMES.imageAssets, makeAsset("img-1", "conv-2"));
    await storage.put(STORE_NAMES.imageAssets, makeAsset("img-2", "conv-1"));
    const loadSpy = vi
      .spyOn(storage, "loadImageBlob")
      .mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    await store.ensureConversationAssets("conv-1");
    await flushMicrotasks();

    // 只装配了 conv-1 的元数据，conv-2 的图片不进窗口、不触发加载
    expect(store.imageById("img-2")).toBeDefined();
    expect(store.imageById("img-1")).toBeUndefined();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("blob-img-2");
  });

  it("当前会话图片按 createdAt 降序插队（最新的先加载）", async () => {
    const { store, storage } = setupWithMemoryStorage();
    for (const asset of [
      makeAsset("img-old", "conv-1", "2026-07-01T00:00:00.000Z"),
      makeAsset("img-new", "conv-1", "2026-08-01T00:00:00.000Z"),
      makeAsset("img-mid", "conv-1", "2026-07-15T00:00:00.000Z"),
    ]) {
      await storage.put(STORE_NAMES.imageAssets, asset);
    }
    const startedKeys: string[] = [];
    vi.spyOn(storage, "loadImageBlob").mockImplementation(
      (key: string) =>
        new Promise<Blob>(() => {
          startedKeys.push(key);
        }),
    );

    await store.ensureConversationAssets("conv-1");
    await flushMicrotasks();

    // 并发上限 2：最新的两张先开始
    expect(startedKeys.slice(0, 2)).toEqual(["blob-img-new", "blob-img-mid"]);
  });

  it("ensurePreviewLoaded 加载成功写入 previewUrl，重复调用去重", async () => {
    const { store, storage } = setup();
    storage.loadImageBlob.mockResolvedValue(
      new Blob(["x"], { type: "image/png" }),
    );
    store.imageAssets = [makeAsset("img-1")];

    store.ensurePreviewLoaded("img-1");
    store.ensurePreviewLoaded("img-1");
    await vi.waitFor(() => {
      expect(store.imageById("img-1")?.previewUrl).toMatch(/^blob:mock-/);
    });
    expect(storage.loadImageBlob).toHaveBeenCalledTimes(1);
    expect(store.isPreviewLoading("img-1")).toBe(false);
    expect(store.isPreviewError("img-1")).toBe(false);
  });

  it("已有 previewUrl 或 blobKey 缺失时不发起加载", async () => {
    const { store, storage } = setup();
    const withPreview = { ...makeAsset("img-1"), previewUrl: "blob:existing" };
    const noBlob = { ...makeAsset("img-2"), blobKey: undefined };
    store.imageAssets = [withPreview, noBlob];

    store.ensurePreviewLoaded("img-1");
    store.ensurePreviewLoaded("img-2");
    await flushMicrotasks();
    expect(storage.loadImageBlob).not.toHaveBeenCalled();
  });

  it("并发上限为 2，前一张完成后才启动下一张", async () => {
    const { store, storage } = setup();
    const { startedKeys, releaseNext } = gateLoads(storage);
    store.imageAssets = ["a", "b", "c", "d"].map((id) =>
      makeAsset(`img-${id}`, "conv-2"), // 非当前会话，避免 hydrate/watch 干扰
    );

    for (const id of ["img-a", "img-b", "img-c", "img-d"]) {
      store.ensurePreviewLoaded(id);
    }
    await flushMicrotasks();
    expect(startedKeys).toEqual(["blob-img-a", "blob-img-b"]);

    releaseNext();
    await flushMicrotasks();
    expect(startedKeys).toEqual(["blob-img-a", "blob-img-b", "blob-img-c"]);

    releaseNext();
    await flushMicrotasks();
    expect(startedKeys).toHaveLength(4);
  });

  it("prioritizePreviews 把指定 id 插到队首", async () => {
    const { store, storage } = setup();
    const { startedKeys, releaseNext } = gateLoads(storage);
    store.imageAssets = ["a", "b", "c", "d"].map((id) =>
      makeAsset(`img-${id}`, "conv-2"),
    );

    // 占满并发（a、b），d 排队，然后 c 插队
    store.ensurePreviewLoaded("img-a");
    store.ensurePreviewLoaded("img-b");
    store.ensurePreviewLoaded("img-d");
    store.prioritizePreviews(["img-c"]);
    await flushMicrotasks();
    expect(startedKeys).toEqual(["blob-img-a", "blob-img-b"]);

    // 放行后 c 先于 d 启动
    releaseNext();
    await flushMicrotasks();
    expect(startedKeys[2]).toBe("blob-img-c");

    releaseNext();
    await flushMicrotasks();
    expect(startedKeys[3]).toBe("blob-img-d");
  });

  it("加载失败标记 error，重试后成功并清除状态", async () => {
    const { store, storage } = setup();
    storage.loadImageBlob.mockRejectedValueOnce(new Error("network"));
    store.imageAssets = [makeAsset("img-1")];

    store.ensurePreviewLoaded("img-1");
    await vi.waitFor(() => {
      expect(store.isPreviewError("img-1")).toBe(true);
    });
    expect(store.imageById("img-1")?.previewUrl).toBeUndefined();

    storage.loadImageBlob.mockResolvedValue(
      new Blob(["x"], { type: "image/png" }),
    );
    store.ensurePreviewLoaded("img-1"); // error 态允许重试
    await vi.waitFor(() => {
      expect(store.imageById("img-1")?.previewUrl).toMatch(/^blob:mock-/);
    });
    expect(store.isPreviewError("img-1")).toBe(false);
  });

  it("blob 不存在（undefined）也进入 error 态", async () => {
    const { store, storage } = setup();
    storage.loadImageBlob.mockResolvedValue(undefined);
    store.imageAssets = [makeAsset("img-1")];

    store.ensurePreviewLoaded("img-1");
    await vi.waitFor(() => {
      expect(store.isPreviewError("img-1")).toBe(true);
    });
  });

  it("切换会话自动把新会话图片插队队首", async () => {
    const { store, storage, activeConversationId } = setup();
    const { startedKeys } = gateLoads(storage);
    store.imageAssets = [
      makeAsset("img-c1", "conv-1"),
      makeAsset("img-c2", "conv-2"),
    ];

    activeConversationId.value = "conv-2";
    await nextTick();
    await flushMicrotasks();
    expect(startedKeys).toContain("blob-img-c2");
  });
});

describe("imagesStore 分页加载（PR-c）", () => {
  function ts(seq: number): string {
    return `2026-08-01T00:${String(Math.floor(seq / 60)).padStart(2, "0")}:${String(
      seq % 60,
    ).padStart(2, "0")}.000Z`;
  }

  async function seedAssets(
    storage: InMemoryStorage,
    conversationId: string,
    count: number,
    prefix = "img",
  ) {
    for (let i = 1; i <= count; i++) {
      await storage.put(
        STORE_NAMES.imageAssets,
        makeAsset(`${prefix}-${i}`, conversationId, ts(i)),
      );
    }
  }

  it("loadAssetsFirstPage 整体替换窗口并设置游标/total", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await seedAssets(storage, "conv-1", IMAGE_ASSETS_PAGE_SIZE + 10);
    store.imageAssets = [makeAsset("stale")];

    const data = await store.loadAssetsFirstPage();

    expect(data).toHaveLength(IMAGE_ASSETS_PAGE_SIZE);
    expect(store.imageAssets).toHaveLength(IMAGE_ASSETS_PAGE_SIZE);
    expect(store.imageById("stale")).toBeUndefined();
    // DESC：最新的在最前
    expect(store.imageAssets[0]?.id).toBe(`img-${IMAGE_ASSETS_PAGE_SIZE + 10}`);
    expect(store.assetsNextCursor).not.toBeNull();
    expect(store.assetsTotal).toBe(IMAGE_ASSETS_PAGE_SIZE + 10);
  });

  it("loadMoreAssets 追加下一页并去重，耗尽后游标置空", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await seedAssets(storage, "conv-1", IMAGE_ASSETS_PAGE_SIZE + 10);

    await store.loadAssetsFirstPage();
    await store.loadMoreAssets();

    expect(store.imageAssets).toHaveLength(IMAGE_ASSETS_PAGE_SIZE + 10);
    const ids = store.imageAssets.map((asset) => asset.id);
    expect(new Set(ids).size).toBe(ids.length); // 无重复
    expect(store.assetsNextCursor).toBeNull();

    // 保持 DESC 序
    const createdAts = store.imageAssets.map((asset) => asset.createdAt);
    expect(createdAts).toEqual([...createdAts].sort().reverse());
  });

  it("ensureConversationAssets 幂等 + 在飞去重：同会话只拉一次", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await seedAssets(storage, "conv-1", 3);
    const listPageSpy = vi.spyOn(storage, "listPage");

    await Promise.all([
      store.ensureConversationAssets("conv-1"),
      store.ensureConversationAssets("conv-1"),
    ]);
    await store.ensureConversationAssets("conv-1");

    expect(listPageSpy).toHaveBeenCalledTimes(1);
    expect(store.imageAssets).toHaveLength(3);
    expect(store.assetsEnsuredConversationId).toBe("conv-1");

    // 换会话后重新拉取
    await seedAssets(storage, "conv-2", 2, "other");
    await store.ensureConversationAssets("conv-2");
    expect(store.imageAssets).toHaveLength(5);
  });

  it("ensureAssetsLoaded 只补窗口外缺失的图片", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await seedAssets(storage, "conv-1", 2);
    await store.loadAssetsFirstPage();
    await storage.put(
      STORE_NAMES.imageAssets,
      makeAsset("img-outside", "conv-9"),
    );

    await store.ensureAssetsLoaded(["img-1", "img-outside"]);

    expect(store.imageById("img-outside")).toBeDefined();
    expect(store.imageAssets).toHaveLength(3);
  });

  it("resetPagination 清空窗口与分页状态", async () => {
    const { store, storage } = setupWithMemoryStorage();
    await seedAssets(storage, "conv-1", 3);
    await store.loadAssetsFirstPage();
    await store.ensureConversationAssets("conv-1");

    store.resetPagination();

    expect(store.imageAssets).toEqual([]);
    expect(store.assetsNextCursor).toBeNull();
    expect(store.assetsTotal).toBe(0);
    expect(store.assetsEnsuredConversationId).toBe("");
  });

  it("refreshStorageUsage 走注入的 storageUsage service（不回退模块级默认实例）", async () => {
    // 回归：Companion 模式下曾错用模块级默认实例（无参 resolveStorage 恒为
    // IndexedDbStorage），容量估算读成了浏览器 IndexedDB 的数字。
    const storage = createSpyStorage();
    const estimate = vi.fn().mockResolvedValue({
      imageBytes: 100,
      metadataBytes: 50,
      projectBytes: 150,
    });
    const store = useImagesStore();
    store.configureImagesStore({
      services: {
        imageAssets: createImageAssetServices(storage),
        // 结构兼容的最小 mock：只注入 estimate
        storageUsage: { estimate },
      },
      activeConversationId: ref("conv-1"),
      messages: ref([]),
      onStorageError: vi.fn(),
    });

    await store.refreshStorageUsage();

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(store.storageUsage?.projectBytes).toBe(150);
    // 不得触碰存储后端的聚合接口（那是模块级默认实例的路径）
    expect(storage.estimateStoredBytes).not.toHaveBeenCalled();
  });
});

describe("imagesStore 写入失败回滚（D2）", () => {
  function setupForMutations() {
    const storage = createSpyStorage();
    const store = useImagesStore();
    const activeConversationId = ref("conv-1");
    const onStorageError = vi.fn();
    store.configureImagesStore({
      services: {
        imageAssets: createImageAssetServices(storage),
        storageUsage: createStorageUsageServices(storage),
      },
      activeConversationId,
      messages: ref([]),
      onStorageError,
    });
    return { store, storage, onStorageError };
  }

  /** 让 feedback.requestConfirmation 直接返回 true（跳过确认弹窗）。 */
  function autoConfirm() {
    const feedback = useFeedbackStore();
    vi.spyOn(feedback, "requestConfirmation").mockResolvedValue(true);
    return feedback;
  }

  it("renameImage 持久化成功返回 true 且更新内存", async () => {
    const { store } = setupForMutations();
    store.imageAssets = [makeAsset("img-1")];

    const result = await store.renameImage("img-1", "新名字");

    expect(result).toBe(true);
    expect(store.imageById("img-1")?.name).toBe("新名字");
  });

  it("renameImage 持久化失败回滚内存原名并返回 false", async () => {
    const { store, storage, onStorageError } = setupForMutations();
    store.imageAssets = [makeAsset("img-1")];
    storage.put.mockRejectedValueOnce(new Error("quota"));

    const result = await store.renameImage("img-1", "新名字");

    expect(result).toBe(false);
    expect(store.imageById("img-1")?.name).toBe("img-1"); // 原名恢复
    expect(onStorageError).toHaveBeenCalledTimes(1);
  });

  it("setImageTagColor 持久化失败回滚内存原颜色并返回 false", async () => {
    const { store, storage, onStorageError } = setupForMutations();
    store.imageAssets = [{ ...makeAsset("img-1"), tagColor: "red" }];
    storage.put.mockRejectedValueOnce(new Error("quota"));

    const result = await store.setImageTagColor("img-1", "blue");

    expect(result).toBe(false);
    expect(store.imageById("img-1")?.tagColor).toBe("red"); // 原颜色恢复
    expect(onStorageError).toHaveBeenCalledTimes(1);
  });

  it("setImageTagColor 持久化成功返回 true 且记录事件", async () => {
    const { store } = setupForMutations();
    store.imageAssets = [makeAsset("img-1")];

    const result = await store.setImageTagColor("img-1", "blue");

    expect(result).toBe(true);
    expect(store.imageById("img-1")?.tagColor).toBe("blue");
  });

  it("deleteImage 持久化失败时把图片塞回内存（回滚乐观删除）", async () => {
    const { store, storage, onStorageError } = setupForMutations();
    autoConfirm();
    store.imageAssets = [makeAsset("img-1")];
    storage.delete.mockRejectedValueOnce(new Error("io"));

    await store.deleteImage("img-1");

    expect(store.imageById("img-1")).toBeDefined(); // 回滚回来了
    expect(onStorageError).toHaveBeenCalledTimes(1);
  });

  it("deleteImages 批量持久化失败时回滚全部已乐观删除的图片", async () => {
    const { store, storage, onStorageError } = setupForMutations();
    store.imageAssets = [
      makeAsset("img-1"),
      { ...makeAsset("img-2"), conversationId: "conv-1" },
    ];
    storage.delete.mockRejectedValue(new Error("io"));

    await store.deleteImages(["img-1", "img-2"]);

    expect(store.imageById("img-1")).toBeDefined();
    expect(store.imageById("img-2")).toBeDefined();
    expect(store.imageAssets).toHaveLength(2);
    expect(onStorageError).toHaveBeenCalled();
  });
});
