<script setup lang="ts">
/**
 * 顶层 App：按运行形态渲染工作台。
 *
 * 连接模式切换的「组件级重建」机制（替代整页 reload）：
 * 独立态下监听 settingsStore.connectionMode，切换时先持久化设置，再改 appKey
 * 触发 <StudioShell> 卸载重建——useStudioViewModel 会重新执行 resolveStorage()，
 * 按新模式装配 storage 实例并重新 hydrate。比 window.location.reload 更顺滑
 * （不闪白、不重新下载资源），且等价于「整个工作台换后端」。
 *
 * 无需 isHydrated 守卫：connectionMode 的初始值同步从 localStorage 镜像读取
 * （settingsStore），hydrate 的 applySettings 故意不回写它，所以本 watch 只在
 * 用户真正切换时触发，不会被 hydrate 误触发。嵌入态由宿主固定，跳过。
 */
import { ref, watch } from "vue";
import StudioShell from "./components/studio/StudioShell.vue";
import { useSettingsStore } from "./stores/settingsStore";
import { CONNECTION_MODE_SWITCHED_KEY } from "./shared/constants";

const settings = useSettingsStore();

// StudioShell 的重建 key。切换连接模式时自增，强制整个子树卸载重建。
const appKey = ref(0);

watch(
  () => settings.connectionMode,
  async (next, prev) => {
    // 桌面内置态连接模式锁定，与嵌入态同样跳过重建。
    if (settings.isEmbedded || settings.isDesktopCompanion || next === prev) return;
    // 切换前先持久化，确保重建后 resolveStorage / hydrate 能读到新模式。
    // saveCurrentSettings 写 IndexedDB settings 表（Promise），需 await 落盘。
    try {
      await settings.saveCurrentSettings();
    } catch {
      // 持久化失败不阻断重建——connectionMode 的 localStorage 镜像已在
      // settingsStore 的 watch 里同步写回，重建后至少能按新模式启动。
    }
    // 写 sessionStorage 标记，重建后 ViewModel onMounted 读它显示切换成功提示。
    try {
      sessionStorage.setItem(CONNECTION_MODE_SWITCHED_KEY, next);
    } catch {
      // sessionStorage 不可用（隐私模式等）时静默降级，不阻断重建。
    }
    // 改 key 触发 <StudioShell> 卸载重建：useStudioViewModel 重跑、storage 重装配。
    appKey.value++;
  },
);
</script>

<template>
  <StudioShell :key="appKey" />
</template>
