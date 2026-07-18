import { describe, expect, it } from "vitest";
import { listProviderIds } from "../registry.js";
import {
  PROVIDER_PROFILES,
  getProviderProfile,
} from "../providerProfiles.js";

describe("providerProfiles config table", () => {
  it("covers every provider registered in the registry", () => {
    const registered = listProviderIds();
    const configured = Object.keys(PROVIDER_PROFILES);
    // 每个已注册 provider 都必须有能力配置（防止新增 provider 漏配）
    for (const id of registered) {
      expect(configured, `provider "${id}" 未在 PROVIDER_PROFILES 中配置`).toContain(id);
    }
    // 每个 profile 也必须有可执行的 adapter（防止 profile 被 UI 展示但无法生成）
    for (const id of configured) {
      expect(registered, `profile "${id}" 未注册 adapter`).toContain(id);
    }
  });

  it.each(Object.keys(PROVIDER_PROFILES))(
    "has a complete profile for provider %s",
    (providerId) => {
      const profile = PROVIDER_PROFILES[providerId];
      expect(profile).toBeDefined();

      // preset 字段齐全，默认连接信息与能力配置共用同一份 profile
      expect(profile.preset.label).toEqual(expect.any(String));
      expect(profile.preset.defaultBaseUrl).toMatch(/^https?:\/\//);
      expect(profile.preset.defaultModel).toEqual(expect.any(String));
      expect(Number.isFinite(profile.preset.order)).toBe(true);

      // capability 字段齐全
      const { capability } = profile;
      expect(capability.generate).toBe(true);
      expect(typeof capability.edit).toBe("boolean");
      expect(typeof capability.mask).toBe("boolean");
      expect(capability.backgrounds.length).toBeGreaterThan(0);
      expect(capability.outputFormats.length).toBeGreaterThan(0);

      // sizeConstraints 字段齐全
      const { sizeConstraints: sc } = profile;
      expect(typeof sc.step).toBe("number");
      expect(typeof sc.min).toBe("number");
      expect(typeof sc.max).toBe("number");
      expect(typeof sc.maxPixels).toBe("number");
      expect(typeof sc.minPixels).toBe("number");
      expect(sc.defaultSize).toMatch(/^\d+x\d+$/);

      // resolutionOptions 非空且每项形状合法
      expect(profile.resolutionOptions.length).toBeGreaterThan(0);
      for (const opt of profile.resolutionOptions) {
        expect(typeof opt.value).toBe("string");
        expect(typeof opt.label).toBe("string");
        expect(typeof opt.targetPixels).toBe("number");
      }
    },
  );

  it("wan declares a pro model variant with unique modelId", () => {
    const wan = PROVIDER_PROFILES.wan;
    expect(wan.variants).toBeDefined();
    expect(wan.variants!.length).toBe(1);

    const variant = wan.variants![0];
    expect(variant.modelId).toBe("wan2.7-image-pro");
    expect(variant.sizeConstraints).toBeDefined();
    expect(variant.resolutionOptions.length).toBeGreaterThan(wan.resolutionOptions.length);
  });

  it("declares provider-specific edit limits in profile data", () => {
    expect(PROVIDER_PROFILES.qwen.editConstraints?.maxImages).toBe(3);
    expect(PROVIDER_PROFILES.wan.editConstraints?.maxImages).toBe(9);
    expect(
      PROVIDER_PROFILES.wan.editConstraints?.resolutionOptions?.map((option) => option.value),
    ).toEqual(["1k", "2k"]);
  });

  it("getProviderProfile returns the configured profile", () => {
    expect(getProviderProfile("openai")).toBe(PROVIDER_PROFILES.openai);
  });

  it("getProviderProfile returns undefined for unknown provider", () => {
    expect(getProviderProfile("does-not-exist")).toBeUndefined();
  });

  it("orders presets by the profile order field", async () => {
    const { PROVIDER_PRESETS } = await import("../../providerPresets.js");
    const orders = PROVIDER_PRESETS.map(
      (preset) => PROVIDER_PROFILES[preset.id].preset.order,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });
});
