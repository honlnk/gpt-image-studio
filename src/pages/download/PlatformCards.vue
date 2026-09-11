<script setup lang="ts">
/**
 * 平台下载卡片区。可用性完全由 release.assets 驱动：CI 发布某平台安装包后，
 * 对应按钮自动点亮；未提供的平台显示「敬请期待」。
 */
import {
  GITHUB_RELEASES_URL,
  type DesktopReleaseInfo,
} from "../../shared/downloads";
import { formatAssetSize } from "./releaseClient";

defineProps<{ release: DesktopReleaseInfo }>();
</script>

<template>
  <div class="grid gap-5 sm:grid-cols-3">
    <!-- macOS -->
    <div class="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-2.5">
        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/>
        </svg>
        <div>
          <div class="font-semibold">macOS</div>
          <div class="text-xs text-gray-500">Apple Silicon（M 系列芯片）</div>
        </div>
      </div>
      <p class="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
        下载 dmg 拖入「应用程序」即可。未签名应用首次打开需放行一次，<a href="#macos-guide" class="text-gray-900 underline underline-offset-2">看图文指引</a>。
      </p>
      <a
        v-if="release.assets.macArm64"
        :href="release.assets.macArm64.url"
        class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
      >
        下载 dmg
        <span class="font-normal text-gray-300">{{ formatAssetSize(release.assets.macArm64.sizeBytes) }}</span>
      </a>
      <span
        v-else
        class="mt-5 inline-flex cursor-not-allowed items-center justify-center rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400"
      >
        敬请期待
      </span>
      <p class="mt-2 text-xs text-gray-400">Intel 芯片版本后续提供</p>
    </div>

    <!-- Windows -->
    <div class="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-2.5">
        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 5.5l7.5-1v7.1H3V5.5zM11.6 4.4L21 3.3v8.3h-9.4V4.4zM3 12.6h7.5v7.1L3 18.7v-6.1zM11.6 12.6H21v8.3l-9.4-1.1v-7.2z"/>
        </svg>
        <div>
          <div class="font-semibold">Windows</div>
          <div class="text-xs text-gray-500">64 位 · NSIS 安装包</div>
        </div>
      </div>
      <p class="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
        安装包未签名，首次运行 SmartScreen 点「更多信息 → 仍要运行」即可正常使用。
      </p>
      <a
        v-if="release.assets.windowsX64"
        :href="release.assets.windowsX64.url"
        class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
      >
        下载安装包
        <span class="font-normal text-gray-300">{{ formatAssetSize(release.assets.windowsX64.sizeBytes) }}</span>
      </a>
      <span
        v-else
        class="mt-5 inline-flex cursor-not-allowed items-center justify-center rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400"
      >
        敬请期待 · 随下一版本发布
      </span>
      <p class="mt-2 text-xs text-gray-400">构建流水线已就绪，发版后此按钮自动开放</p>
    </div>

    <!-- Linux -->
    <div class="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-2.5">
        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <div>
          <div class="font-semibold">Linux</div>
          <div class="text-xs text-gray-500">AppImage · deb</div>
        </div>
      </div>
      <p class="mt-3 flex-1 text-sm leading-relaxed text-gray-600">
        无来源检查机制：AppImage 加执行权限即跑，deb 直接安装。
      </p>
      <div class="mt-5 flex flex-col gap-2">
        <a
          v-if="release.assets.linuxAppImage"
          :href="release.assets.linuxAppImage.url"
          class="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
        >
          AppImage
          <span class="font-normal text-gray-300">{{ formatAssetSize(release.assets.linuxAppImage.sizeBytes) }}</span>
        </a>
        <a
          v-if="release.assets.linuxDeb"
          :href="release.assets.linuxDeb.url"
          class="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400"
        >
          deb
          <span class="font-normal text-gray-400">{{ formatAssetSize(release.assets.linuxDeb.sizeBytes) }}</span>
        </a>
        <span
          v-if="!release.assets.linuxAppImage && !release.assets.linuxDeb"
          class="inline-flex cursor-not-allowed items-center justify-center rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400"
        >
          敬请期待 · 随下一版本发布
        </span>
      </div>
      <p class="mt-2 text-xs text-gray-400">构建流水线已就绪，发版后按钮自动开放</p>
    </div>
  </div>

  <p class="mt-6 text-center text-xs text-gray-400">
    需要历史版本或校验文件？前往
    <a :href="GITHUB_RELEASES_URL" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-gray-600">GitHub Releases</a>
    下载任意版本。
  </p>
</template>
