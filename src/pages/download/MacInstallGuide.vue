<script setup lang="ts">
/**
 * macOS 安装教学区。
 * 顶部是推荐方式：curl|sh 一行命令安装（命令行下载不写隔离标记，
 * Gatekeeper 零警告，见分发方案 §3.1）；下方为浏览器手动下载的
 * Gatekeeper 放行指引（文案与分发方案 §3.2 一致）。
 * 文案走 download.ui.guide 词键；命令串与文件名保持原样不翻。
 */
import { ref } from "vue";

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/honlnk/gpt-image-studio/main/scripts/install-desktop.sh | sh";
const XATTR_COMMAND = "xattr -cr /Applications/GPT\\ Image\\ Studio.app";

/** 当前显示「已复制」反馈的命令 key；空串表示无。 */
const copiedKey = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCommand(key: string, text: string) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // clipboard API 不可用/被拒（部分 webview、权限策略）时退化到
    // 隐藏 textarea + execCommand 的老路径
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    textarea.remove();
  }
  // 两条通道都失败才静默——命令文本就在页面上，用户可手选复制
  if (!ok) return;
  copiedKey.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copiedKey.value = ""), 2000);
}
</script>

<template>
  <h2 class="text-2xl font-bold tracking-tight">{{ $t("download.ui.guide.title") }}</h2>

  <!-- 推荐方式：一行命令安装（curl 下载不带隔离属性，全程不触发 Gatekeeper） -->
  <div class="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
    <div class="flex items-center gap-2">
      <span class="rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{{ $t("download.ui.guide.recommended") }}</span>
      <div class="font-medium">{{ $t("download.ui.guide.recommendedTitle") }}</div>
    </div>
    <p class="mt-2 text-sm leading-relaxed text-gray-600">
      {{ $t("download.ui.guide.recommendedDesc") }}
    </p>
    <div class="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-950 px-4 py-3">
      <code class="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-emerald-300">{{ INSTALL_COMMAND }}</code>
      <button
        type="button"
        class="shrink-0 cursor-pointer rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
        @click="copyCommand('install', INSTALL_COMMAND)"
      >
        {{ copiedKey === "install" ? $t("download.ui.guide.copied") : $t("download.ui.guide.copy") }}
      </button>
    </div>
    <p class="mt-2 text-xs text-gray-400">
      {{ $t("download.ui.guide.auditNote") }}<a href="https://github.com/honlnk/gpt-image-studio/blob/main/scripts/install-desktop.sh" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-gray-600">scripts/install-desktop.sh</a>
    </p>
  </div>

  <!-- 手动方式：浏览器下载 dmg 后的 Gatekeeper 放行指引 -->
  <p class="mt-10 text-sm font-semibold text-gray-900">{{ $t("download.ui.guide.manualTitle") }}</p>
  <p class="mt-2 text-sm leading-relaxed text-gray-500">
    {{ $t("download.ui.guide.manualIntro1") }}<strong class="font-medium text-gray-700">{{ $t("download.ui.guide.manualIntroBold") }}</strong>{{ $t("download.ui.guide.manualIntro2") }}<a href="https://github.com/honlnk/gpt-image-studio" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-gray-700">{{ $t("download.ui.guide.manualIntroLink") }}</a>{{ $t("download.ui.guide.manualIntro3") }}
  </p>

  <ol class="mt-8 space-y-6">
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">1</span>
      <div>
        <div class="font-medium">{{ $t("download.ui.guide.step1Title") }}</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          {{ $t("download.ui.guide.step1Desc1") }}<code class="rounded bg-gray-100 px-1.5 py-0.5 text-[13px]">.dmg</code>{{ $t("download.ui.guide.step1Desc2") }}<strong class="font-medium">GPT Image Studio</strong>{{ $t("download.ui.guide.step1Desc3") }}
        </p>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">2</span>
      <div>
        <div class="font-medium">{{ $t("download.ui.guide.step2Title") }}</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          {{ $t("download.ui.guide.step2Desc1") }}<strong class="font-medium">{{ $t("download.ui.guide.step2Bold1") }}</strong>{{ $t("download.ui.guide.step2Desc2") }}<strong class="font-medium">{{ $t("download.ui.guide.step2Bold2") }}</strong>{{ $t("download.ui.guide.step2Desc3") }}
          <span class="text-gray-400">{{ $t("download.ui.guide.step2Note") }}</span>
        </p>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">3</span>
      <div class="min-w-0 flex-1">
        <div class="font-medium">{{ $t("download.ui.guide.step3Title") }}</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          {{ $t("download.ui.guide.step3Desc") }}
        </p>
        <div class="mt-2.5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-950 px-4 py-3">
          <code class="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-emerald-300">{{ XATTR_COMMAND }}</code>
          <button
            type="button"
            class="shrink-0 cursor-pointer rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
            @click="copyCommand('xattr', XATTR_COMMAND)"
          >
            {{ copiedKey === "xattr" ? $t("download.ui.guide.copied") : $t("download.ui.guide.copy") }}
          </button>
        </div>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">4</span>
      <div>
        <div class="font-medium">{{ $t("download.ui.guide.step4Title") }}</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          {{ $t("download.ui.guide.step4Desc") }}
        </p>
      </div>
    </li>
  </ol>
</template>
