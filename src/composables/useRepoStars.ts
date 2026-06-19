import { onMounted, readonly, ref } from "vue";

const REPO_API = "https://api.github.com/repos/honlnk/gpt-image-studio";

// 模块级缓存：同一页面会话内只请求一次，多个组件共享结果。
let cachedStars: number | null = null;
let cachedFailed = false;
let pending: Promise<void> | null = null;

const stars = ref<number | null>(null);
const failed = ref(false);

function fetchStars(): Promise<void> {
  if (pending) return pending;

  pending = (async () => {
    try {
      const res = await fetch(REPO_API);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = (await res.json()) as { stargazers_count?: number };
      cachedStars = data.stargazers_count ?? 0;
      cachedFailed = false;
    } catch {
      cachedFailed = true;
    } finally {
      stars.value = cachedStars;
      failed.value = cachedFailed;
      pending = null;
    }
  })();

  return pending;
}

/**
 * 获取 GPT Image Studio 仓库的 GitHub star 数。
 * 多个组件共用同一份缓存，整个页面会话内只发一次请求。
 * 首次调用时在 onMounted 自动触发请求。
 */
export function useRepoStars() {
  onMounted(() => {
    if (stars.value === null && !failed.value && !pending) {
      void fetchStars();
    }
  });

  return { stars: readonly(stars), failed: readonly(failed) };
}
