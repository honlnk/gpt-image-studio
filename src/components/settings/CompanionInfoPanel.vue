<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompanionStore } from "../../stores/companionStore";
import { openAdminWindow } from "../../services/desktopCompanion";

/**
 * Companion 基本信息面板（仅 Companion 模式显示）。
 *
 * 只放 web 端必需的连接信息：在线状态、连接密钥、管理页入口。
 * 所有 Companion 配置（provider 凭据、存储位置、日志）都在 Companion 自带管理页维护。
 *
 * 桌面内置态（isDesktopCompanion）：sidecar 随应用启动并自动连接，
 * 密钥粘贴卡替换为内置服务状态卡；管理页入口保留（桌面凭据管理的唯一入口），
 * 点击经 open_admin_window 在应用内开原生子窗口。
 */

const { t } = useI18n();
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

// 桌面内置态：管理页在应用内子窗口打开（open_admin_window 命令）。
function openAdminExternally() {
  void openAdminWindow(companionAdminUrl.value).catch(() => {});
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
        <p class="font-medium text-gray-800">{{
          $t("settings.companion.localServiceTitle")
        }}</p>
        <p class="text-xs leading-relaxed">
          {{ $t("settings.companion.localServiceDescription") }}
        </p>
      </div>

      <!-- 桌面内置态：sidecar 随应用启动自动连接，密钥粘贴卡替换为状态卡 -->
      <div
        v-if="settings.isDesktopCompanion"
        class="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2"
      >
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-green-800">{{
            $t("settings.companion.builtinTitle")
          }}</span>
          <span
            class="text-xs"
            :class="companion.companionOnline ? 'text-green-600' : 'text-amber-600'"
          >
            {{
              companion.companionOnline
                ? $t("settings.companion.statusRunning")
                : $t("settings.companion.statusStartingOrOffline")
            }}
          </span>
        </div>
        <p class="text-xs leading-relaxed text-green-700">
          {{ $t("settings.companion.builtinDescription") }}
        </p>
      </div>

      <!-- 连接密钥：Web 端向 Companion 证明身份的 Bearer 密钥（权威存储 localStorage） -->
      <div
        v-if="!settings.isEmbedded && !settings.isDesktopCompanion"
        class="rounded-lg border border-gray-200 p-4 space-y-3"
      >
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-700">{{
            $t("settings.companion.connectionTitle")
          }}</h4>
          <span
            class="text-xs"
            :class="companion.companionOnline ? 'text-green-600' : 'text-gray-400'"
          >
            {{
              companion.companionOnline
                ? $t("settings.companion.online")
                : $t("settings.companion.offline")
            }}
          </span>
        </div>

        <template v-if="settings.companionConnected">
          <div class="flex items-center justify-between">
            <span class="text-sm text-green-700">{{
              $t("settings.companion.connected")
            }}</span>
            <button
              class="cursor-pointer text-xs text-red-500 hover:text-red-700"
              type="button"
              @click="companion.disconnect()"
            >
              {{ $t("settings.companion.disconnect") }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="text-sm text-gray-500">
            {{ $t("settings.companion.keyPasteHint") }}
            {{ $t("settings.companion.keyViewHintBefore") }}
            <span class="font-mono text-gray-700">gpt-image-studio status</span>
            {{ $t("settings.companion.keyViewHintAfter") }}
          </p>
          <div class="flex gap-2">
            <input
              v-model="accessKeyInput"
              class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-500"
              :placeholder="$t('settings.companion.keyPlaceholder')"
              @keydown.enter="connectCompanion"
            />
            <button
              class="cursor-pointer rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
              type="button"
              :disabled="companion.connecting || !accessKeyInput.trim()"
              @click="connectCompanion"
            >
              {{
                companion.connecting
                  ? $t("settings.companion.connecting")
                  : $t("settings.companion.connect")
              }}
            </button>
          </div>
        </template>

        <p v-if="companion.connectError" class="text-xs text-red-600">
          {{ companion.connectError }}
        </p>
      </div>

      <!-- Companion 管理页入口：server/嵌入态下管理页已禁用（多租户管理面在宿主），不显示。
           桌面内置态保留（provider 凭据管理的唯一入口），经 opener 系统浏览器打开。 -->
      <div
        v-if="!settings.isEmbedded"
        class="flex items-center justify-between rounded-lg border border-gray-200 p-3"
      >
        <div class="text-xs text-gray-500">
          {{ $t("settings.companion.adminHint") }}
        </div>
        <button
          v-if="settings.isDesktopCompanion"
          class="shrink-0 cursor-pointer rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
          type="button"
          @click="openAdminExternally"
        >
          {{ $t("settings.companion.openAdmin") }}
        </button>
        <a
          v-else
          :href="companionAdminUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
        >
          {{ $t("settings.companion.openAdmin") }}
        </a>
      </div>

      <!-- v0.6 升级提示：默认收起，避免干扰日常使用 -->
      <div>
        <button
          class="cursor-pointer text-xs text-gray-400 underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
          type="button"
          @click="upgradeHintVisible = !upgradeHintVisible"
        >
          {{
            upgradeHintVisible
              ? $t("settings.companion.hideUpgradeHint")
              : $t("settings.companion.showUpgradeHint")
          }}
        </button>
        <div
          v-if="upgradeHintVisible"
          class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2"
        >
          <p class="text-sm font-medium text-amber-800">{{
            $t("settings.companion.upgradeHintTitle")
          }}</p>
          <p class="text-xs leading-relaxed text-amber-700">
            {{ $t("settings.companion.upgradeHintDescription") }}
          </p>
          <ol class="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-amber-700">
            <li>{{ $t("settings.companion.upgradeStepUpdate") }}<span class="font-mono text-amber-900">npm install -g @honlnk/image-studio-companion@latest</span></li>
            <li>{{ $t("settings.companion.upgradeStepRemoveConfig") }}<span class="font-mono text-amber-900">rm ~/.gpt-image-studio/credentials.json</span></li>
            <li>{{ $t("settings.companion.upgradeStepReconfigure") }}</li>
          </ol>
        </div>
      </div>
    </div>
  </section>
</template>
