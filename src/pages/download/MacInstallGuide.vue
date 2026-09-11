<script setup lang="ts">
/**
 * macOS 安装教学区：未签名应用的 Gatekeeper 放行指引。
 * 文案与分发方案 §3.2 一致（docs/plans/desktop-distribution-plan.md）；
 * 安装脚本（curl|sh）区块在 §4.2 完成后补充到本区顶部作为「推荐方式」。
 */
import { ref } from "vue";

const XATTR_COMMAND = "xattr -cr /Applications/GPT\\ Image\\ Studio.app";

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCommand() {
  let ok = false;
  try {
    await navigator.clipboard.writeText(XATTR_COMMAND);
    ok = true;
  } catch {
    // clipboard API 不可用/被拒（部分 webview、权限策略）时退化到
    // 隐藏 textarea + execCommand 的老路径
    const textarea = document.createElement("textarea");
    textarea.value = XATTR_COMMAND;
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
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <h2 class="text-2xl font-bold tracking-tight">macOS 安装指引</h2>
  <p class="mt-2 text-sm leading-relaxed text-gray-500">
    安装包没有购买 Apple 开发者签名（$99/年，对本项目没有性价比），首次打开会被
    Gatekeeper 拦一次。这是<strong class="font-medium text-gray-700">开源未签名软件的正常提示，不是病毒</strong>——
    整个应用（<a href="https://github.com/honlnk/gpt-image-studio" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-gray-700">源码</a>）都可审计。放行一次，之后与正常应用无异。
  </p>

  <ol class="mt-8 space-y-6">
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">1</span>
      <div>
        <div class="font-medium">安装</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          打开下载的 <code class="rounded bg-gray-100 px-1.5 py-0.5 text-[13px]">.dmg</code> 文件，把
          <strong class="font-medium">GPT Image Studio</strong> 拖进「应用程序」（Applications）文件夹。
        </p>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">2</span>
      <div>
        <div class="font-medium">首次打开：方式一（图形界面）</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          双击打开会提示「无法打开，因为无法验证开发者」。这时前往
          <strong class="font-medium">系统设置 → 隐私与安全性</strong>，下拉到「安全性」一节，点
          GPT Image Studio 旁的「<strong class="font-medium">仍要打开</strong>」。
          <span class="text-gray-400">（macOS 15 起已不再支持「右键 → 打开」的老旁路。）</span>
        </p>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">3</span>
      <div class="min-w-0 flex-1">
        <div class="font-medium">首次打开：方式二（终端一行命令）</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          更习惯终端的话，清除下载隔离属性即可，与方式一等效：
        </p>
        <div class="mt-2.5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-950 px-4 py-3">
          <code class="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-emerald-300">{{ XATTR_COMMAND }}</code>
          <button
            type="button"
            class="shrink-0 cursor-pointer rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
            @click="copyCommand"
          >
            {{ copied ? "已复制 ✓" : "复制" }}
          </button>
        </div>
      </div>
    </li>
    <li class="flex gap-4">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">4</span>
      <div>
        <div class="font-medium">正常使用</div>
        <p class="mt-1 text-sm leading-relaxed text-gray-600">
          之后从「应用程序」或 Launchpad 正常打开即可。内嵌的 Companion 服务会随应用自动启动并完成连接，
          打开设置页即可配置服务商凭据。
        </p>
      </div>
    </li>
  </ol>
</template>
