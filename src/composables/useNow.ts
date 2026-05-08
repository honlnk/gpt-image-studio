import { onUnmounted, ref } from "vue";

export function useNow(intervalMs = 30_000) {
  const now = ref(Date.now());
  const timer = window.setInterval(() => {
    now.value = Date.now();
  }, intervalMs);

  onUnmounted(() => {
    window.clearInterval(timer);
  });

  return now;
}
