import { onUnmounted, ref } from "vue";

export function useNow(intervalMs = 30_000) {
  const now = ref(Date.now());
  // 构建期预渲染（vite-ssg，Node 环境）会执行组件 setup，此时没有 window，
  // 不启动定时器（与 generationStore 的 typeof window 守卫同一约定）；
  // SSR 渲染用不到动态时间，首次取值 Date.now() 已足够。
  let timer: number | undefined;
  if (typeof window !== "undefined") {
    timer = window.setInterval(() => {
      now.value = Date.now();
    }, intervalMs);
  }

  onUnmounted(() => {
    if (timer !== undefined) {
      window.clearInterval(timer);
    }
  });

  return now;
}
