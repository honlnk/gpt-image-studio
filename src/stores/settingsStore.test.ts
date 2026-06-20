import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
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

  it("applies GLM size constraints: hides 4K, custom 512-2048 step 32", () => {
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

    // GLM maxPixels=4194304，4K(8294400) 被隐藏，只剩 1K/2K
    expect(s.sizeResolutionOptions.map((o) => o.value)).toEqual(["1k", "2k"]);
    expect(s.sizeStep).toBe(32);
    expect(s.minCustomDimension).toBe(512);
    expect(s.maxCustomDimension).toBe(2048);
    expect(s.currentSizeConstraints.maxAspectRatio).toBeNull();
  });

  it("falls back resolution when provider drops it (GLM hides 4K, current 4K resets)", () => {
    const s = useSettingsStore();
    // OpenAI 模式下选 4K
    s.applySizeResolution("4k");
    expect(s.sizeResolution).toBe("4k");

    // 切 GLM → 4K 不可用，自动回退
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
});
