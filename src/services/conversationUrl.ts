/**
 * 当前对话 id 与 URL 的双向同步（阶段三 PR7 §2.1/§2.2）。
 *
 * URL 形式：query 参数 `?c=<conversationId>`。为什么不用 hash / pathname，
 * 以及与 `urlSettings.ts` 的"一次性消费"参数的语义区分，见
 * `docs/evolution/phase3-pr7-embed-experience.md` §2.1。
 *
 * 写策略（§2.2）：主动切换走 `pushState`（进历史栈，后退可逐会话回退），
 * 兜底同步走 `replaceState`（不污染历史栈）。调用方按场景选 mode。
 *
 * location / history 可注入，便于单元测试（沿用 `urlSettings.ts` 的范式）。
 */

/** URL 上记录当前对话 id 的 query 键名。短键，避免 URL 过长。 */
export const CONVERSATION_QUERY_KEY = "c";

/** 写 URL 的模式：push 进历史栈 / replace 仅更新当前条目。 */
export type WriteConversationUrlMode = "push" | "replace";

/**
 * 从 URL 读当前对话 id。
 *
 * @returns trim 后的 id；URL 无 `?c=` 或值为空时返回 null。
 *          不校验 id 是否真实存在——存在性校验由调用方做（遵循 D1 数据集隔离，
 *          无效 id 静默回落）。
 */
export function readConversationIdFromUrl(
  location: Pick<Location, "search"> = window.location,
): string | null {
  const raw = new URLSearchParams(location.search).get(CONVERSATION_QUERY_KEY);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * 把当前对话 id 写入 URL。
 *
 * 保留 URL 上其它 query 参数（如 urlSettings 尚未消费的参数），只增删 `c` 键。
 * hash 段原样保留。空 id 时删除 `c` 键（如会话全删后的空状态）。
 *
 * @param id 目标对话 id；空串表示删除 `?c=`。
 * @param mode `"push"` 进历史栈（用户主动切换，可后退回退）；
 *             `"replace"` 仅更新当前条目（兜底同步：首次激活、删除回落、新建会话等）。
 *             默认 `"replace"`，避免遗漏 mode 时污染历史栈。
 */
export function writeConversationIdToUrl(
  id: string,
  mode: WriteConversationUrlMode = "replace",
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "pushState" | "replaceState"> = window.history,
): void {
  const params = new URLSearchParams(location.search);
  if (id) {
    params.set(CONVERSATION_QUERY_KEY, id);
  } else {
    params.delete(CONVERSATION_QUERY_KEY);
  }
  const nextSearch = params.toString();
  const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`;
  if (mode === "push") {
    history.pushState(null, "", nextUrl);
  } else {
    history.replaceState(null, "", nextUrl);
  }
}
