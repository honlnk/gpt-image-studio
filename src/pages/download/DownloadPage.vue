<script setup lang="ts">
/**
 * /download 下载页（预渲染静态营销页，zh /download 与 en /en/download 双语）。
 *
 * - SSG：entry-ssg.ts 按路由渲染本组件（不挂 pinia），初始数据是
 *   FALLBACK_RELEASE，保证爬虫/无 JS 环境看到完整内容与有效下载链接；
 * - 客户端：main.ts 按 location.pathname 分流后动态 import 本组件挂载，
 *   onMounted 里跑 GitHub Releases API 把按钮切换到真实最新版本；
 * - 语言：文案全部走 download.ui 前缀的词键；页头提供另一语言互链；挂载后
 *   若页面语言与浏览器语言不匹配，显示一条切换提示条（SSG 首屏不渲染）；
 * - 不初始化工作室的 analytics/IndexedDB 体系（本页刻意零存储零埋点）。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  FALLBACK_RELEASE,
  GITHUB_RELEASES_URL,
  type DesktopPlatformKey,
  type DesktopReleaseInfo,
} from "../../shared/downloads";
import { currentLocale, detectSystemLocale } from "../../i18n";
import {
  detectPlatform,
  fetchLatestDesktopRelease,
  formatAssetSize,
  type DetectedPlatform,
} from "./releaseClient";
import { DOWNLOAD_URLS } from "./content";
import PlatformCards from "./PlatformCards.vue";
import MacInstallGuide from "./MacInstallGuide.vue";
import FaqSection from "./FaqSection.vue";

const { t } = useI18n();

const release = ref<DesktopReleaseInfo>(FALLBACK_RELEASE);
const platform = ref<DetectedPlatform>("unknown");

/** 语言提示条：内容语言与浏览器语言不匹配时提示另一语言版本（初始 false，SSG 首屏不渲染）。 */
const showLocaleNotice = ref(false);

onMounted(async () => {
  // 与 i18n 的系统语言检测同一口径：任一 navigator 偏好语言以 zh 开头视为中文用户
  const browserLocale = detectSystemLocale();
  showLocaleNotice.value =
    currentLocale() === "zh-CN"
      ? browserLocale !== "zh-CN"
      : browserLocale === "zh-CN";

  platform.value = detectPlatform();
  release.value = await fetchLatestDesktopRelease();
});

const publishedDate = computed(() => release.value.publishedAt.slice(0, 10));

/** 平台展示名（hero 推荐按钮；键必须全字面量，供 scripts/i18n-verify-refs.mjs 扫描）。 */
const platformLabels = computed<Record<DesktopPlatformKey, string>>(() => ({
  macArm64: t("download.ui.platforms.macArm64"),
  windowsX64: t("download.ui.platforms.windowsX64"),
  linuxAppImage: t("download.ui.platforms.linuxAppImage"),
  linuxDeb: t("download.ui.platforms.linuxDeb"),
}));

/** 另一语言的下载页地址（页头互链与语言提示条共用目标）。 */
const otherLocaleUrl = computed(
  () => DOWNLOAD_URLS[currentLocale() === "en-US" ? "zh" : "en"],
);

/** hero 推荐按钮：按检测到的平台取资产；检测不到 / 该平台暂无资产时回退到任一可用资产。 */
const recommended = computed(() => {
  const order: Record<DetectedPlatform, DesktopPlatformKey[]> = {
    mac: ["macArm64"],
    windows: ["windowsX64"],
    linux: ["linuxAppImage", "linuxDeb"],
    unknown: ["macArm64", "windowsX64", "linuxAppImage"],
  };
  for (const key of order[platform.value]) {
    const asset = release.value.assets[key];
    if (asset) return { key, asset };
  }
  return null;
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
    <!-- 顶栏 -->
    <header class="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
      <a href="/" class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="GPT Image Studio" class="h-8 w-8" />
        <span class="text-[15px] font-semibold tracking-wide">GPT Image Studio</span>
      </a>
      <nav class="flex items-center gap-1 text-sm text-gray-600">
        <a
          :href="otherLocaleUrl"
          class="rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          {{ $t("download.ui.langSwitch") }}
        </a>
        <a
          :href="GITHUB_RELEASES_URL"
          target="_blank"
          rel="noopener"
          class="rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          {{ $t("download.ui.nav.releases") }}
        </a>
        <a
          href="https://github.com/honlnk/gpt-image-studio"
          target="_blank"
          rel="noopener"
          class="rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          GitHub
        </a>
        <a
          href="/"
          class="ml-1 rounded-lg bg-gray-900 px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-gray-700"
        >
          {{ $t("download.ui.nav.openWeb") }}
        </a>
      </nav>
    </header>

    <!-- 语言提示条：页面语言与浏览器语言不匹配时建议切换 -->
    <div
      v-if="showLocaleNotice"
      class="border-b border-amber-100 bg-amber-50 px-6 py-2 text-center text-xs text-amber-800"
    >
      {{ $t("download.ui.noticeText") }}
      <a :href="otherLocaleUrl" class="font-medium underline underline-offset-2 hover:text-amber-900">
        {{ $t("download.ui.noticeLink") }}
      </a>
    </div>

    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(34,211,238,0.12),transparent),radial-gradient(50%_40%_at_80%_20%,rgba(245,158,11,0.08),transparent)]"
      />
      <div class="relative mx-auto max-w-3xl px-6 pt-16 pb-14 text-center">
        <div
          class="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1 text-xs font-medium text-emerald-700"
        >
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {{ $t("download.ui.hero.badge", { version: release.version, date: publishedDate }) }}
        </div>
        <h1 class="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          {{ $t("download.ui.hero.titleLine1") }}<br />{{ $t("download.ui.hero.titleLine2") }}
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-gray-600">
          {{ $t("download.ui.hero.subtitle") }}
        </p>

        <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            v-if="recommended"
            :href="recommended.asset.url"
            class="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-[15px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-800 hover:shadow-md"
          >
            <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {{ $t("download.ui.hero.downloadFor", { platform: platformLabels[recommended.key] }) }}
          </a>
          <a
            :href="GITHUB_RELEASES_URL"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-6 py-3 text-[15px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            {{ $t("download.ui.hero.allReleases") }}
          </a>
        </div>
        <p v-if="recommended" class="mt-3 text-xs text-gray-500">
          {{ recommended.asset.name }} · {{ formatAssetSize(recommended.asset.sizeBytes) }}
          <span v-if="platform === 'unknown'">{{ $t("download.ui.hero.unknownPlatformHint") }}</span>
        </p>
        <p class="mt-4 text-xs text-gray-400">
          {{ $t("download.ui.hero.trustPrefix") }}<a href="#macos-guide" class="underline underline-offset-2 hover:text-gray-600">{{ $t("download.ui.hero.firstRunGuide") }}</a>{{ $t("download.ui.hero.trustSuffix") }}
        </p>
      </div>
    </section>

    <!-- 平台卡片 -->
    <section class="mx-auto max-w-5xl px-6 pb-16">
      <PlatformCards :release="release" />
    </section>

    <!-- macOS 安装教学 -->
    <section id="macos-guide" class="border-y border-gray-200 bg-white">
      <div class="mx-auto max-w-3xl px-6 py-16">
        <MacInstallGuide />
      </div>
    </section>

    <!-- 为什么用桌面版 -->
    <section class="mx-auto max-w-5xl px-6 py-16">
      <h2 class="text-center text-2xl font-bold tracking-tight">{{ $t("download.ui.why.title") }}</h2>
      <p class="mt-2 text-center text-sm text-gray-500">{{ $t("download.ui.why.subtitle") }}</p>
      <div class="mt-10 grid gap-5 sm:grid-cols-2">
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">{{ $t("download.ui.why.feature1Title") }}</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            {{ $t("download.ui.why.feature1Desc") }}
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">{{ $t("download.ui.why.feature2Title") }}</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            {{ $t("download.ui.why.feature2Desc") }}
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">{{ $t("download.ui.why.feature3Title") }}</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            {{ $t("download.ui.why.feature3Desc") }}
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">{{ $t("download.ui.why.feature4Title") }}</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            {{ $t("download.ui.why.feature4Desc") }}
          </p>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="border-t border-gray-200 bg-white">
      <div class="mx-auto max-w-3xl px-6 py-16">
        <FaqSection />
      </div>
    </section>

    <!-- 页脚 -->
    <footer class="border-t border-gray-200">
      <div
        class="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500 sm:flex-row"
      >
        <div>{{ $t("download.ui.footer.license") }}</div>
        <div class="flex items-center gap-5">
          <a href="/" class="transition-colors hover:text-gray-900">{{ $t("download.ui.footer.web") }}</a>
          <a :href="GITHUB_RELEASES_URL" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">{{ $t("download.ui.nav.releases") }}</a>
          <a href="https://github.com/honlnk/gpt-image-studio" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">GitHub</a>
          <a href="https://github.com/honlnk/gpt-image-studio/issues" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">{{ $t("download.ui.footer.issues") }}</a>
        </div>
      </div>
    </footer>
  </div>
</template>
