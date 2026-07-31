<script setup lang="ts">
import { computed, ref } from "vue";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompanionStore } from "../../stores/companionStore";

/**
 * Companion 基本信息面板（仅 Companion 模式显示）。
 *
 * 只放 web 端必需的连接信息：在线状态、连接密钥、管理页入口。
 * 所有 Companion 配置（provider 凭据、存储位置、日志）都在 Companion 自带管理页维护。
 */

const settings = useSettingsStore();
const companion = useCompanionStore();

// Companion 自带管理页地址（companionUrl + /admin）。
const companionAdminUrl = computed(
  () => settings.companionUrl.replace(/\/$/, "") + "/admin",
);

// 连接密钥：Web 端向 Companion 证明身份的 Bearer 密钥（权威存储 localStorage）。
const accessKeyInput = ref("");

function connectCompanion() {
  void companion.connectWithKey(accessKeyInput.value);
  accessKeyInput.value = "";
}

// v0.6 升级提示：默认收起，点击文本按钮才展开。
const upgradeHintVisible = ref(false);
</script>

<template>
  <section aria-labelledby="companionInfoTitle">
    <h3 id="companionInfoTitle" class="text-base font-semibold text-gray-900">
      Companion
    </h3>

    <div class="mt-4 space-y-3">
      <div class="rounded-lg bg-gray-50 p-4 space-y-2 text-sm text-gray-600">
        <p class="font-medium text-gray-800">本地 Companion 服务</p>
        <p class="text-xs leading-relaxed">
          Companion 是一个运行在本机的轻量代理服务，负责将浏览器请求转发给你配置的 AI 图片生成接口。
          provider 凭据、存储位置等配置都在 Companion 自带管理页维护。
        </p>
      </div>

      <!-- 连接密钥：Web 端向 Companion 证明身份的 Bearer 密钥（权威存储 localStorage） -->
      <div
        v-if="!settings.isEmbedded"
        class="rounded-lg border border-gray-200 p-4 space-y-3"
      >
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-700">连接</h4>
          <span
            class="text-xs"
            :class="companion.companionOnline ? 'text-green-600' : 'text-gray-400'"
          >
            {{ companion.companionOnline ? "Companion 在线" : "Companion 离线" }}
          </span>
        </div>

        <template v-if="settings.companionConnected">
          <div class="flex items-center justify-between">
            <span class="text-sm text-green-700">已连接</span>
            <button
              class="cursor-pointer text-xs text-red-500 hover:text-red-700"
              type="button"
              @click="companion.disconnect()"
            >
              断开连接
            </button>
          </div>
        </template>
        <template v-else>
          <p class="text-sm text-gray-500">
            请将 Companion 终端打印的连接密钥粘贴到下方完成连接。
            密钥可在终端用 <span class="font-mono text-gray-700">gpt-image-studio status</span> 查看。
          </p>
          <div class="flex gap-2">
            <input
              v-model="accessKeyInput"
              class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
              placeholder="粘贴连接密钥"
              @keydown.enter="connectCompanion"
            />
            <button
              class="cursor-pointer rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
              type="button"
              :disabled="companion.connecting || !accessKeyInput.trim()"
              @click="connectCompanion"
            >
              {{ companion.connecting ? "连接中…" : "连接" }}
            </button>
          </div>
        </template>

        <p v-if="companion.connectError" class="text-xs text-red-600">
          {{ companion.connectError }}
        </p>
      </div>

      <div class="flex items-center justify-between rounded-lg border border-gray-200 p-3">
        <div class="text-xs text-gray-500">
          provider 凭据、存储位置、日志由 Companion 自带管理页维护
        </div>
        <a
          :href="companionAdminUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
        >
          打开管理页 →
        </a>
      </div>

      <!-- v0.6 升级提示：默认收起，避免干扰日常使用 -->
      <div>
        <button
          class="cursor-pointer text-xs text-gray-400 underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
          type="button"
          @click="upgradeHintVisible = !upgradeHintVisible"
        >
          {{ upgradeHintVisible ? "收起升级提示" : "查看升级提示（从旧版本迁移）" }}
        </button>
        <div
          v-if="upgradeHintVisible"
          class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2"
        >
          <p class="text-sm font-medium text-amber-800">⚙️ 升级提示</p>
          <p class="text-xs leading-relaxed text-amber-700">
            Companion 凭据存储结构已重构，不再兼容旧版本。如果你之前使用过 Companion，请：
          </p>
          <ol class="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-amber-700">
            <li>更新 Companion：<span class="font-mono text-amber-900">npm install -g @honlnk/image-studio-companion@latest</span></li>
            <li>删除旧配置：<span class="font-mono text-amber-900">rm ~/.gpt-image-studio/credentials.json</span></li>
            <li>前往管理页重新添加 provider 配置</li>
          </ol>
        </div>
      </div>
    </div>
  </section>
</template>
