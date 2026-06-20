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
});
