/**
 * 阶段三 PR5：qiankun 嵌入态测试。
 *
 * 验证：
 * 1. settingsStore.applyEmbeddedConfig 正确注入三 refs + isEmbedded 标记。
 * 2. 嵌入态跳过 companionUrl/accessKey 持久化。
 * 3. 嵌入态 connectionMode 固定 localCompanion。
 *
 * 不直接测 main.ts 的生命周期（有 app.mount 副作用），而是测注入逻辑的核心
 * （applyEmbeddedConfig），它是嵌入态配置生效的关键。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./stores/settingsStore.js";

describe("qiankun 嵌入态配置注入", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("applyEmbeddedConfig 设置 companionUrl + jwt + connectionMode + isEmbedded", () => {
    const store = useSettingsStore();
    store.applyEmbeddedConfig({
      companionUrl: "https://companion.example.com",
      jwt: "eyJhbGciOiJIUzI1NiJ9.test.test",
    });

    expect(store.companionUrl).toBe("https://companion.example.com");
    expect(store.companionAccessKey).toBe("eyJhbGciOiJIUzI1NiJ9.test.test");
    expect(store.connectionMode).toBe("localCompanion");
    expect(store.isEmbedded).toBe(true);
  });

  it("嵌入态 connectionMode 固定 localCompanion（applyEmbeddedConfig 后）", () => {
    const store = useSettingsStore();
    expect(store.connectionMode).toBe("direct"); // 默认 direct

    store.applyEmbeddedConfig({ companionUrl: "http://x", jwt: "y" });
    expect(store.connectionMode).toBe("localCompanion");
  });

  it("applyEmbeddedConfig 幂等（重复调用以最新值为准）", () => {
    const store = useSettingsStore();
    store.applyEmbeddedConfig({ companionUrl: "http://a", jwt: "token-a" });
    store.applyEmbeddedConfig({ companionUrl: "http://b", jwt: "token-b" });

    expect(store.companionUrl).toBe("http://b");
    expect(store.companionAccessKey).toBe("token-b");
    expect(store.isEmbedded).toBe(true);
  });

  it("独立态默认 isEmbedded=false", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);
  });
});

describe("qiankun 嵌入态持久化跳过", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("嵌入态 isEmbedded=true 标记生效（持久化 watch 据此跳过）", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);

    store.applyEmbeddedConfig({ companionUrl: "http://x", jwt: "y" });
    // applyEmbeddedConfig 设置 isEmbedded=true，watch 会据此跳过持久化
    expect(store.isEmbedded).toBe(true);
  });

  it("独立态 isEmbedded=false（持久化正常生效）", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);
    // 独立态改 companionUrl 会触发持久化（watch 不跳过）
    store.companionUrl = "http://standalone";
    expect(store.isEmbedded).toBe(false);
  });
});
