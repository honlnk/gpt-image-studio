// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  detectSystemLocale,
  normalizeLanguageSetting,
  resolveLocale,
  setAppLocale,
  t,
} from "./index";
import { useSettingsStore } from "../stores/settingsStore";
import { i18n } from "./index";

function stubNavigatorLanguages(languages: string[]) {
  vi.stubGlobal("navigator", { languages, language: languages[0] ?? "" });
}

describe("语言解析链", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("detectSystemLocale：偏好列表含 zh 开头语言 → zh-CN", () => {
    stubNavigatorLanguages(["en-US", "zh-Hans-CN"]);
    expect(detectSystemLocale()).toBe("zh-CN");
  });

  it("detectSystemLocale：无中文偏好 → en-US", () => {
    stubNavigatorLanguages(["en-US", "ja-JP"]);
    expect(detectSystemLocale()).toBe("en-US");
  });

  it("detectSystemLocale：navigator 不可用（SSR/Node）→ en-US", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectSystemLocale()).toBe("en-US");
  });

  it("resolveLocale：显式设置优先，auto 跟随系统检测", () => {
    stubNavigatorLanguages(["en-US"]);
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale("auto")).toBe("en-US");
    stubNavigatorLanguages(["zh-CN"]);
    expect(resolveLocale("auto")).toBe("zh-CN");
  });

  it("normalizeLanguageSetting：非法值回退 auto", () => {
    expect(normalizeLanguageSetting("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguageSetting("fr")).toBe("auto");
    expect(normalizeLanguageSetting(undefined)).toBe("auto");
  });
});

describe("settingsStore.setLanguage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("切换语言同步 i18n locale 并写 localStorage 镜像", () => {
    const settings = useSettingsStore();
    stubNavigatorLanguages(["en-US"]);
    expect(i18n.global.locale.value).toBe("en-US");

    settings.setLanguage("zh-CN");
    expect(settings.language).toBe("zh-CN");
    expect(i18n.global.locale.value).toBe("zh-CN");
    expect(localStorage.getItem("gpt-image-studio:language")).toBe("zh-CN");

    settings.setLanguage("auto");
    // auto → 回到系统检测（en-US）
    expect(i18n.global.locale.value).toBe("en-US");
    expect(localStorage.getItem("gpt-image-studio:language")).toBe("auto");
  });

  it("词库两种语言都能取到试点词条", () => {
    setAppLocale("zh-CN");
    expect(t("settings.general.title")).toBe("通用");
    setAppLocale("en-US");
    expect(t("settings.general.title")).toBe("General");
    // 插值参数
    expect(t("settings.general.switchTitle", { target: "X" })).toContain("X");
  });
});
