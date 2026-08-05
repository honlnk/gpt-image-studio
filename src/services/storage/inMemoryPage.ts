/**
 * 内存分页的共享实现（server 模式分页 PR-b/c）。
 *
 * 两个消费方：
 * - InMemoryStorage.listPage（mock 实现，契约套件要求语义与真实实现一致）；
 * - listPageWithFallback（service 层的回退路径——后端未实现可选方法 listPage 时，
 *   全量 list + 内存分页，契约语义保持一致）。
 *
 * 语义与 Companion 服务端 listPage 对齐：DESC（排序值降序、同值主键降序）、
 * (排序值, 主键) 双字段游标、排序字段缺失（null）排最后且不可翻页、
 * total 是过滤后总条数（不受 before/limit 影响）。
 */
import {
  CONVERSATION_FILTERABLE_STORES,
  STORE_KEY_PATHS,
  STORE_SORT_FIELDS,
  decodePageCursor,
  encodePageCursor,
  isBeforePageCursor,
  type ListPageOptions,
  type ListPageResult,
  type StoreName,
  type StudioStorage,
} from "./types";

/** 对内存中的记录数组做分页（调用方提供全量或预过滤的记录）。 */
export function pageRecordsInMemory<T>(
  records: unknown[],
  store: StoreName,
  opts: ListPageOptions,
): ListPageResult<T> {
  const sortField = STORE_SORT_FIELDS[store];
  if (!sortField) {
    throw new Error(`store "${store}" 不支持分页查询`);
  }
  if (opts.conversationId !== undefined && !CONVERSATION_FILTERABLE_STORES.includes(store)) {
    throw new Error(`store "${store}" 不支持 conversationId 过滤`);
  }
  const keyPath = STORE_KEY_PATHS[store];
  const sortValueOf = (r: Record<string, unknown>): string | null => {
    const v = r[sortField];
    return typeof v === "string" ? v : null;
  };
  const keyOf = (r: Record<string, unknown>): string => String(r[keyPath]);

  let filtered = records as Record<string, unknown>[];
  if (opts.conversationId !== undefined) {
    filtered = filtered.filter((r) => r.conversationId === opts.conversationId);
  }
  // DESC：排序值降序，同值主键降序，null 排最后
  filtered.sort((a, b) => {
    const va = sortValueOf(a);
    const vb = sortValueOf(b);
    if (va === null && vb === null) return keyOf(b).localeCompare(keyOf(a));
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return vb.localeCompare(va);
    return keyOf(b).localeCompare(keyOf(a));
  });
  const total = filtered.length;

  const cursorPos = opts.before !== undefined ? decodePageCursor(opts.before) : null;
  if (cursorPos) {
    filtered = filtered.filter((r) =>
      isBeforePageCursor(sortValueOf(r), keyOf(r), cursorPos[0], cursorPos[1]),
    );
  }

  const hasMore = filtered.length > opts.limit;
  const page = hasMore ? filtered.slice(0, opts.limit) : filtered;
  const last = page[page.length - 1];
  return {
    data: page as T[],
    nextCursor: hasMore && last ? encodePageCursor(sortValueOf(last), keyOf(last)) : null,
    total,
  };
}

/**
 * service 层统一入口：后端实现了可选方法 listPage 就原生分页，
 * 否则回退全量 list + 内存分页（T2 修订后接口的可选语义，见 types.ts 头注释）。
 */
export async function listPageWithFallback<T>(
  storage: StudioStorage,
  store: StoreName,
  opts: ListPageOptions,
): Promise<ListPageResult<T>> {
  if (storage.listPage) {
    return storage.listPage<T>(store, opts);
  }
  const all = await storage.list(store);
  return pageRecordsInMemory<T>(all, store, opts);
}

/** 默认页大小（仅 STORE_SORT_FIELDS 列出的 store 适用）。 */
const ITERATE_DEFAULT_PAGE_SIZE = 200;

/**
 * 拉取某 store 的全部记录，但分批请求（server 模式分页 PR-e，备份导出专用）。
 *
 * 与 `list()` 的区别：list() 是一次性全量（Companion 单次全表 HTTP / IndexedDB 单事务）；
 * 本函数在 storage 支持 listPage 时用游标逐页拉取，每页一次请求/事务，避免单次全量
 * 把整张大表物化进一次响应/内存峰值。语义仍是"拉完全部"，返回完整数组。
 *
 * 仅适用于 STORE_SORT_FIELDS 列出的 store（conversations / messages / imageAssets）。
 * 不支持 listPage 的后端（当前不存在）回退单次 list()。
 *
 * 可选 onPage 回调：每拉完一页触发一次，供调用方在条目累计时做流式处理（如逐批构造
 * zip entry），而不必等全部记录到齐。
 */
export async function iterateAll<T>(
  storage: StudioStorage,
  store: StoreName,
  opts?: {
    /** 按 conversationId 过滤（仅 CONVERSATION_FILTERABLE_STORES 适用）。 */
    conversationId?: string;
    /** 每页条数，默认 200（不超过 Companion LIST_PAGE_MAX_LIMIT）。 */
    pageSize?: number;
    /** 每拉完一页触发，参数为本页累计条数。 */
    onPage?: (accumulated: number) => void;
  },
): Promise<T[]> {
  // 不支持 listPage 的后端回退单次全量（当前三实现全部支持 listPage，此分支为兜底）。
  if (!storage.listPage) {
    const all = await storage.list<T>(store);
    opts?.onPage?.(all.length);
    return all;
  }

  const limit = opts?.pageSize ?? ITERATE_DEFAULT_PAGE_SIZE;
  const accumulated: T[] = [];
  let before: string | undefined;
  // 循环翻页直到游标耗尽。
  for (;;) {
    const page = await storage.listPage<T>(store, {
      limit,
      ...(before !== undefined ? { before } : {}),
      ...(opts?.conversationId !== undefined
        ? { conversationId: opts.conversationId }
        : {}),
    });
    accumulated.push(...page.data);
    opts?.onPage?.(accumulated.length);
    if (page.nextCursor === null) break;
    before = page.nextCursor;
  }
  return accumulated;
}
