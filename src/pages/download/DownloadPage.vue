<script setup lang="ts">
/**
 * /download 下载页（预渲染静态营销页）。
 *
 * - SSG：entry-ssg.ts 按路由渲染本组件（不挂 pinia），初始数据是
 *   FALLBACK_RELEASE，保证爬虫/无 JS 环境看到完整内容与有效下载链接；
 * - 客户端：main.ts 按 location.pathname 分流后动态 import 本组件挂载，
 *   onMounted 里跑 GitHub Releases API 把按钮切换到真实最新版本；
 * - 不初始化工作室的 analytics/IndexedDB 体系（本页刻意零存储零埋点）。
 */
import { computed, onMounted, ref } from "vue";
import {
  FALLBACK_RELEASE,
  GITHUB_RELEASES_URL,
  type DesktopPlatformKey,
  type DesktopReleaseInfo,
} from "../../shared/downloads";
import {
  detectPlatform,
  fetchLatestDesktopRelease,
  formatAssetSize,
  type DetectedPlatform,
} from "./releaseClient";
import { PLATFORM_LABELS } from "./content";
import PlatformCards from "./PlatformCards.vue";
import MacInstallGuide from "./MacInstallGuide.vue";
import FaqSection from "./FaqSection.vue";

const release = ref<DesktopReleaseInfo>(FALLBACK_RELEASE);
const platform = ref<DetectedPlatform>("unknown");

onMounted(async () => {
  platform.value = detectPlatform();
  release.value = await fetchLatestDesktopRelease();
});

const publishedDate = computed(() => release.value.publishedAt.slice(0, 10));

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
          :href="GITHUB_RELEASES_URL"
          target="_blank"
          rel="noopener"
          class="rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          全部版本
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
          打开网页版
        </a>
      </nav>
    </header>

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
          开源免费 · MIT · v{{ release.version }}（{{ publishedDate }} 发布）
        </div>
        <h1 class="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          下载 GPT Image Studio<br />桌面版
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-gray-600">
          本地优先的 AI 图片创作工作台。桌面版内嵌 Companion 本地服务——安装即用，
          无需安装 Node、无需手动配对，多服务商凭据管理都在你自己的电脑上完成。
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
            下载 {{ PLATFORM_LABELS[recommended.key] }} 版
          </a>
          <a
            :href="GITHUB_RELEASES_URL"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-6 py-3 text-[15px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            全部版本（GitHub Releases）
          </a>
        </div>
        <p v-if="recommended" class="mt-3 text-xs text-gray-500">
          {{ recommended.asset.name }} · {{ formatAssetSize(recommended.asset.sizeBytes) }}
          <span v-if="platform === 'unknown'">（未识别系统时已为你推荐主流平台，可在下方卡片切换）</span>
        </p>
        <p class="mt-4 text-xs text-gray-400">
          无广告 · 数据不出本机 · 安装包未做平台签名（开源免签名分发，<a href="#macos-guide" class="underline underline-offset-2 hover:text-gray-600">首次打开指引</a>）
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
      <h2 class="text-center text-2xl font-bold tracking-tight">为什么用桌面版？</h2>
      <p class="mt-2 text-center text-sm text-gray-500">网页版已经够用，桌面版让体验再进一步。</p>
      <div class="mt-10 grid gap-5 sm:grid-cols-2">
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">开箱即连</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            内嵌 Companion 本地服务，启动应用自动拉起并完成连接——不用装 Node、不用 npm 全局包、不用复制粘贴连接密钥。和 CLI 版 Companion 共享数据目录，凭据配置两边通用。
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">不受浏览器跨域限制</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            部分中转服务商只返回图片链接而不返回 base64，网页直连模式受 CDN 的 CORS 策略限制可能取不到图。桌面版由本机服务在服务端取图，没有这个问题。
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">数据不出本机</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            会话、图片、服务商凭据全部保存在你自己的电脑上（~/.gpt-image-studio），不经过任何第三方服务器。应用本身不联网、不埋点、无广告。
          </p>
        </div>
        <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="text-lg font-semibold">轻量原生体验</div>
          <p class="mt-2 text-sm leading-relaxed text-gray-600">
            基于 Tauri v2 系统 webview，安装包只有数 MB（而非 Electron 的数百 MB）。独立窗口、独立数据分区，与浏览器里的网页版互不影响。
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
        <div>MIT 开源 · © honlnk</div>
        <div class="flex items-center gap-5">
          <a href="/" class="transition-colors hover:text-gray-900">网页版</a>
          <a :href="GITHUB_RELEASES_URL" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">全部版本</a>
          <a href="https://github.com/honlnk/gpt-image-studio" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">GitHub</a>
          <a href="https://github.com/honlnk/gpt-image-studio/issues" target="_blank" rel="noopener" class="transition-colors hover:text-gray-900">问题反馈</a>
        </div>
      </div>
    </footer>
  </div>
</template>
