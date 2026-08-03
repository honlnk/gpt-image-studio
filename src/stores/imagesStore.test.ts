import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useImagesStore } from "./imagesStore";
import { createImageAssetServices } from "../services/imageAssets";
import {
  createSpyStorage,
  type SpyStorage,
} from "../services/storage/createSpyStorage";
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
    services: { imageAssets: createImageAssetServices(storage) },
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
  it("hydrateImagePreviews 只装配 metadata，不拉取 blob", async () => {
    const { store, storage } = setup();
    const assets = [
      makeAsset("img-1", "conv-2"), // 非当前会话：不应加载
      makeAsset("img-2", "conv-1"),
    ];

    const returned = store.hydrateImagePreviews(assets);
    expect(returned).toEqual(assets);
    expect(returned[0].previewUrl).toBeUndefined();

    store.imageAssets = returned;
    await flushMicrotasks();
    // 只有当前会话（conv-1）的图片被自动 prioritize
    expect(storage.loadImageBlob).toHaveBeenCalledTimes(1);
    expect(storage.loadImageBlob).toHaveBeenCalledWith("blob-img-2");
  });

  it("hydrate 对当前会话图片按 createdAt 降序插队（最新的先加载）", async () => {
    const { store, storage } = setup();
    const { startedKeys } = gateLoads(storage);
    const assets = [
      makeAsset("img-old", "conv-1", "2026-07-01T00:00:00.000Z"),
      makeAsset("img-new", "conv-1", "2026-08-01T00:00:00.000Z"),
      makeAsset("img-mid", "conv-1", "2026-07-15T00:00:00.000Z"),
    ];
    store.imageAssets = store.hydrateImagePreviews(assets);
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
