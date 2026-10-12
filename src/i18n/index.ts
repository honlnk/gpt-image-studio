import { createI18n } from "vue-i18n";
import { zhCN } from "../locales/zh-CN";
import { enUS } from "../locales/en-US";
import type { AppLocale, LanguageSetting } from "../types/studio";

/**
 * i18n 实例与语言解析（docs/plans/i18n-plan.md）。
 *
 * 解析优先级：显式设置（AppSettings.language / localStorage 镜像）→ 系统 locale
 * 检测（navigator.languages）→ en-US 兜底。桌面端（Tauri webview）的
 * navigator.language 即系统语言，无需 Rust 侧插件。
 *
 * 镜像键与连接配置镜像（settingsStore 的 SETTINGS_STORAGE_KEYS）同一模式：
 * 启动期同步读取，避免刷新时闪回默认语言；index.html 的首帧内联脚本读取同一
 * 键在 JS bundle 之前就替换 splash 文案。
 *
 * 非组件模块（stores / services / promptBuilder）统一用本文件导出的 `t`；
 * 组件模板用 `$t`（globalInjection），`<script setup>` 用 `useI18n()`。
 */
export const LANGUAGE_MIRROR_KEY = "gpt-image-studio:language";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

export function normalizeLanguageSetting(value: unknown): LanguageSetting {
  return isAppLocale(value) ? value : "auto";
}

/** 检测系统 locale：任一偏好语言以 zh 开头 → zh-CN，否则 en-US。 */
export function detectSystemLocale(): AppLocale {
  if (typeof navigator === "undefined") return "en-US";
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ];
  for (const lang of candidates) {
    if (typeof lang === "string" && lang.toLowerCase().startsWith("zh")) {
      return "zh-CN";
    }
  }
  return "en-US";
}

export function resolveLocale(setting: LanguageSetting): AppLocale {
  return setting === "auto" ? detectSystemLocale() : setting;
}

function readMirrorSetting(): LanguageSetting {
  try {
    return normalizeLanguageSetting(
      window.localStorage.getItem(LANGUAGE_MIRROR_KEY),
    );
  } catch {
    return "auto";
  }
}

export function writeLanguageMirror(setting: LanguageSetting) {
  try {
    window.localStorage.setItem(LANGUAGE_MIRROR_KEY, setting);
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：本次会话内仍生效。
  }
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveLocale(readMirrorSetting()),
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
});

/**
 * 非组件模块用的 t（组件请用 useI18n() / $t，保持响应式追踪）。
 *
 * Composer 原始 t 的重载签名会随词库 schema 推断爆炸（TS2589），
 * 这里收敛为「key + 可选插值参数 / 复数」两种形态的松散签名。
 */
type LooseT = (key: string, arg?: Record<string, unknown> | number) => string;
const looseT = i18n.global.t as unknown as LooseT;

export function t(key: string, params?: Record<string, unknown>): string;
export function t(key: string, plural: number): string;
export function t(
  key: string,
  arg?: Record<string, unknown> | number,
): string {
  return looseT(key, arg);
}

/** 当前生效语言（i18n locale 的快捷读法；格式化 / 排序用它派生）。 */
export function currentLocale(): AppLocale {
  return isAppLocale(i18n.global.locale.value)
    ? i18n.global.locale.value
    : "en-US";
}

/** 切换 i18n 语言并同步 html lang / document.title。 */
export function setAppLocale(locale: AppLocale) {
  i18n.global.locale.value = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.title = t("common.appTitle");
  }
}
