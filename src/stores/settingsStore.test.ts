import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useSettingsStore } from "./settingsStore";
import type { CompanionAuthStatus } from "../types/companion";

// localStorage 兜底：vitest 默认 node 环境，settingsStore 初始化会读 localStorage。
const store: Record<string, string> = {};
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
});

function makeStatus(overrides: Partial<CompanionAuthStatus> = {}): CompanionAuthStatus {
  return {
    provider: "openai",
    mode: "api_key",
    ready: true,
    accountLabel: "sk-a***",
    model: "gpt-image-2",
    capability: {
      generate: true,
      edit: true,
      mask: true,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "webp", "jpeg"],
    },
    sizeConstraints: {
      step: 16,
      min: 16,
      max: 3840,
      maxPixels: 8294400,
      minPixels: 655360,
      maxAspectRatio: 3,
      defaultSize: "1024x1024",
    },
    resolutionOptions: [
      { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
      { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
      { value: "4k", label: "4K", targetPixels: 3840 * 2160 },
    ],
    ...overrides,
  };
}

describe("settingsStore capability-driven UI", () => {
  it("defaults to OpenAI capability with transparent filtered out", () => {
    const s = useSettingsStore();
    // 未回流时背景不含 transparent（与 gpt-image-2 现状一致）
    expect(s.backgroundOptions.map((o) => o.value)).toEqual(["auto", "opaque"]);
    expect(s.transparentDisabled).toBe(true);
    // 全格式默认可见
    expect(s.formatOptions.map((o) => o.value)).toEqual(["png", "webp", "jpeg"]);
    // mask 默认支持 → 区域编辑可见
    expect(s.providerCapability.mask).toBe(true);
  });

  it("applyProviderInfo writes companion-reported model + capability + constraints", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        model: "glm-image",
        capability: {
          generate: true,
          edit: false,
          mask: false,
          backgrounds: ["auto", "opaque"],
          outputFormats: ["png", "jpeg"],
        },
        sizeConstraints: {
          step: 32,
          min: 512,
          max: 2048,
          maxPixels: 4194304,
          minPixels: 0,
          maxAspectRatio: null,
          defaultSize: "1280x1280",
        },
      }),
    );

    expect(s.model).toBe("glm-image");
    expect(s.providerCapability.mask).toBe(false);
    // webp 被过滤掉
    expect(s.formatOptions.map((o) => o.value)).toEqual(["png", "jpeg"]);
  });

  it("applyProviderInfo(null) resets capability to OpenAI defaults", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        model: "glm-image",
        capability: {
          generate: true,
          edit: false,
          mask: false,
          backgrounds: ["auto"],
          outputFormats: ["png"],
        },
      }),
    );
    expect(s.providerCapability.mask).toBe(false);

    s.applyProviderInfo(null);
    // 回退 OpenAI 默认
    expect(s.providerCapability.mask).toBe(true);
    expect(s.formatOptions.map((o) => o.value)).toEqual(["png", "webp", "jpeg"]);
  });

  it("falls back current background when provider drops the selected value", () => {
    const s = useSettingsStore();
    // 先设成 transparent（模拟支持 transparent 的 provider 切走）
    s.applyProviderInfo(
      makeStatus({
        capability: {
          generate: true,
          edit: true,
          mask: true,
          backgrounds: ["auto", "opaque", "transparent"],
          outputFormats: ["png", "webp", "jpeg"],
        },
      }),
    );
    s.background = "transparent";
    expect(s.backgroundOptions.map((o) => o.value)).toContain("transparent");

    // 切到不支持 transparent 的 provider → 自动回退
    s.applyProviderInfo(
      makeStatus({
        capability: {
          generate: true,
          edit: true,
          mask: true,
          backgrounds: ["auto", "opaque"],
          outputFormats: ["png", "webp", "jpeg"],
        },
      }),
    );
    expect(s.background).toBe("auto");
  });

  it("does not clobber model when companion offline (preserves last value)", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(makeStatus({ model: "glm-image" }));
    expect(s.model).toBe("glm-image");
    // 离线：model 保留，不回退（避免 UI 闪烁）
    s.applyProviderInfo(null);
    expect(s.model).toBe("glm-image");
  });

  it("defaults to OpenAI size constraints (16-3840, step 16, 4K visible)", () => {
    const s = useSettingsStore();
    expect(s.sizeStep).toBe(16);
    expect(s.minCustomDimension).toBe(16);
    expect(s.maxCustomDimension).toBe(3840);
    // OpenAI maxPixels=8294400，4K(targetPixels=8294400) 刚好保留
    expect(s.sizeResolutionOptions.map((o) => o.value)).toEqual(["1k", "2k", "4k"]);
  });

  it("applies GLM size constraints: resolutionOptions [1k,2k] (GLM declares its own tiers)", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        sizeConstraints: {
          step: 32,
          min: 512,
          max: 2048,
          maxPixels: 4194304,
          minPixels: 0,
          maxAspectRatio: null,
          defaultSize: "1280x1280",
        },
        // D1：GLM 声明自己的档位 [1k, 2k]——4K 不显示是因为没声明，不再靠 maxPixels 过滤
        resolutionOptions: [
          { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
          { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
        ],
      }),
    );

    // GLM 声明的档位 [1k, 2k]
    expect(s.sizeResolutionOptions.map((o) => o.value)).toEqual(["1k", "2k"]);
    expect(s.sizeStep).toBe(32);
    expect(s.minCustomDimension).toBe(512);
    expect(s.maxCustomDimension).toBe(2048);
    expect(s.currentSizeConstraints.maxAspectRatio).toBeNull();
  });

  it("falls back resolution when provider drops it (GLM [1k,2k], current 4K resets)", () => {
    const s = useSettingsStore();
    // OpenAI 模式下选 4K
    s.applySizeResolution("4k");
    expect(s.sizeResolution).toBe("4k");

    // 切 GLM → 4K 不在 GLM 声明的档位里，自动回退到第一个可用档
    s.applyProviderInfo(
      makeStatus({
        sizeConstraints: {
          step: 32,
          min: 512,
          max: 2048,
          maxPixels: 4194304,
          minPixels: 0,
          maxAspectRatio: null,
          defaultSize: "1280x1280",
        },
        resolutionOptions: [
          { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
          { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
        ],
      }),
    );
    expect(s.sizeResolution).toBe("1k");
  });

  it("customSizeError reflects provider constraints (GLM rejects 3840)", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        sizeConstraints: {
          step: 32,
          min: 512,
          max: 2048,
          maxPixels: 4194304,
          minPixels: 0,
          maxAspectRatio: null,
          defaultSize: "1280x1280",
        },
      }),
    );
    s.applySizePreset("custom");
    s.imageWidth = 3840;
    s.imageHeight = 3840;
    // 3840 超 GLM 的 max=2048
    expect(s.customSizeError).toContain("512 到 2048");

    // 合法值无报错
    s.imageWidth = 1280;
    s.imageHeight = 1280;
    expect(s.customSizeError).toBe("");
  });

  it("GLM has no aspect ratio error (maxAspectRatio=null)", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        sizeConstraints: {
          step: 32,
          min: 512,
          max: 2048,
          maxPixels: 4194304,
          minPixels: 0,
          maxAspectRatio: null,
          defaultSize: "1280x1280",
        },
      }),
    );
    s.applySizePreset("custom");
    // 2048x512 = 4:1，GLM 不限制长宽比，只看范围/像素
    s.imageWidth = 2048;
    s.imageHeight = 512;
    expect(s.customSizeError).toBe("");
  });

  it("Doubao declares [2k, 3k, 4k] tiers (no 1k, native 3k appears)", () => {
    const s = useSettingsStore();
    s.applyProviderInfo(
      makeStatus({
        provider: "doubao",
        sizeConstraints: {
          step: 1,
          min: 512,
          max: 4096,
          maxPixels: 16777216,
          minPixels: 3686400,
          maxAspectRatio: 16,
          defaultSize: "2048x2048",
        },
        resolutionOptions: [
          { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
          { value: "3k", label: "3K", targetPixels: 2880 * 1620 },
          { value: "4k", label: "4K", targetPixels: 4096 * 2160 },
        ],
      }),
    );
    // 豆包档位 [2k, 3k, 4k]——1K 被自然排除，3K 是豆包原生档
    expect(s.sizeResolutionOptions.map((o) => o.value)).toEqual(["2k", "3k", "4k"]);
    // 默认选中档 1k 不在豆包列表里 → 回退第一个 2k
    expect(s.sizeResolution).toBe("2k");
    // step=1（无步长约束）
    expect(s.sizeStep).toBe(1);
    // 豆包 minPixels=3686400，自定义尺寸低于下限报错
    s.applySizePreset("custom");
    s.imageWidth = 1024;
    s.imageHeight = 1024;
    expect(s.customSizeError).toContain("总像素");
  });

  it("applyProviderInfo(null) resets resolutionOptions to OpenAI defaults [1k,2k,4k]", () => {
    const s = useSettingsStore();
    // 先切豆包（档位 [2k,3k,4k]，选中 3k）
    s.applyProviderInfo(
      makeStatus({
        resolutionOptions: [
          { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
          { value: "3k", label: "3K", targetPixels: 2880 * 1620 },
          { value: "4k", label: "4K", targetPixels: 4096 * 2160 },
        ],
      }),
    );
    s.applySizeResolution("3k");
    expect(s.sizeResolution).toBe("3k");

    // 离线 → 回退 OpenAI 默认档位 [1k,2k,4k]，3k 不在默认列表 → 回退 1k
    s.applyProviderInfo(null);
    expect(s.sizeResolutionOptions.map((o) => o.value)).toEqual(["1k", "2k", "4k"]);
    expect(s.sizeResolution).toBe("1k");
  });
});

describe("settingsStore connectionMode → apiMode 校正", () => {
  it("切到 companion 模式时，残留的 responses 被校正为 images", async () => {
    const s = useSettingsStore();
    // direct 模式下用户选了 responses
    s.connectionMode = "direct";
    s.apiMode = "responses";
    expect(s.apiMode).toBe("responses");

    // 切到 companion —— 校正应触发
    s.connectionMode = "localCompanion";
    await nextTick();

    expect(s.apiMode).toBe("images");
  });

  it("切到 companion 时若已是 images，保持不变", async () => {
    const s = useSettingsStore();
    s.connectionMode = "direct";
    s.apiMode = "images";

    s.connectionMode = "localCompanion";
    await nextTick();

    expect(s.apiMode).toBe("images");
  });

  it("切回 direct 模式时，apiMode 不被强制改写（保留用户选择）", async () => {
    const s = useSettingsStore();
    s.connectionMode = "localCompanion";
    // companion 模式下被校正为 images
    await nextTick();
    expect(s.apiMode).toBe("images");

    // 用户在 direct 模式重新选 responses
    s.connectionMode = "direct";
    s.apiMode = "responses";
    await nextTick();

    // 切回 direct 不应被改写
    expect(s.apiMode).toBe("responses");
  });
});
