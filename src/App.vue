<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import StudioShell from "./components/studio/StudioShell.vue";
import CompanionPage from "./pages/CompanionPage.vue";

/**
 * 顶层路由分发：按 URL path 决定渲染工作台还是 Companion 管理页。
 * 不引入 vue-router——项目只有两个页面，一个 path 判断 + popstate 监听足够。
 *
 * History 路由 /companion：dev 模式 Vite 自带 SPA fallback；生产环境靠 404.html。
 */
function isCompanionRoute(): boolean {
  return /\/companion\/?$/.test(window.location.pathname);
}

const route = ref(isCompanionRoute());

function syncRoute() {
  route.value = isCompanionRoute();
}

onMounted(() => {
  window.addEventListener("popstate", syncRoute);
});

onUnmounted(() => {
  window.removeEventListener("popstate", syncRoute);
});
</script>

<template>
  <CompanionPage v-if="route" />
  <StudioShell v-else />
</template>
