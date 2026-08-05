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
