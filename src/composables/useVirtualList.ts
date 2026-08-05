/**
 * 固定高度虚拟列表 composable（server 模式分页 PR-e，图片库虚拟滚动）。
 *
 * 适用场景：垂直列表、条目高度固定（或近似固定）、向下追加方向。
 * 不适用：可变高度（聊天消息卡片）、向上 prepend（消息历史）——那两者复杂度高，
 * backlog 明确后置。
 *
 * 与 PR9 IntersectionObserver 懒加载共存：虚拟化只决定哪些卡片进 DOM，
 * 卡片进 DOM 后的 blob 懒加载逻辑（ImageCard.vue 内）原样保留。
 *
 * 实现思路：
 * - 外层容器是 overflow-y-auto 滚动容器；监听其 scroll/resize 维护 scrollTop/clientHeight。
 * - 纯函数 computeWindow(scrollTop, viewportHeight, count, itemHeight, overscan) 算可见区间。
 * - 组件用 totalHeight 撑出滚动条总高（占位），用 translateY 把可见条目移到正确位置。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** 默认上下多渲染的缓冲条数，避免快速滚动时闪白。 */
const DEFAULT_OVERSCAN = 4;
/** 滚到底触发 loadMore 的阈值（px），与原 ImageGrid onScroll 一致。 */
const DEFAULT_BOTTOM_THRESHOLD = 48;

/**
 * 纯函数：根据当前滚动位置与视口高度计算应渲染的条目区间。
 *
 * 提取为独立导出函数，便于单元测试（无 DOM 依赖）。
 *
 * @returns startIndex 含、endIndex 不含；offsetY 是可见区顶部相对总内容的偏移；
 *          totalHeight 是撑滚动条的总高。
 */
export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  itemHeight: number,
  overscan: number,
): { startIndex: number; endIndex: number; offsetY: number; totalHeight: number } {
  const totalHeight = count * itemHeight;
  if (count === 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetY: 0, totalHeight };
  }

  const firstVisible = Math.floor(scrollTop / itemHeight);
  const lastVisible = Math.floor((scrollTop + viewportHeight) / itemHeight);

  const startIndex = Math.max(0, firstVisible - overscan);
  // endIndex 不含，lastVisible 是最后一个可见条目索引，+1 转不含，再 +overscan 缓冲。
  const endIndex = Math.min(count, lastVisible + 1 + overscan);
  // 可见区第一条相对 totalHeight 的偏移，translateY 用。
  const offsetY = startIndex * itemHeight;

  return { startIndex, endIndex, offsetY, totalHeight };
}

export interface UseVirtualListOptions<T> {
  /** 全部条目（响应式，长度变化时重算区间）。 */
  items: Ref<readonly T[]>;
  /** 滚动容器的 ref（由组件通过 template ref 提供）。 */
  containerRef: Ref<HTMLElement | null>;
  /** 单条高度（px）。调用方需保证条目实际渲染高度与此一致。 */
  itemHeight: number;
  /** 上下各多渲染的缓冲条数，默认 4。 */
  overscan?: number;
  /** 滚到底触发 onLoadMore 的阈值（px），默认 48。 */
  bottomThreshold?: number;
  /** 滚到底回调（通常触发翻页加载下一页）。 */
  onLoadMore?: () => void;
}

export function useVirtualList<T>(options: UseVirtualListOptions<T>) {
  const {
    items,
    containerRef,
    itemHeight,
    overscan = DEFAULT_OVERSCAN,
    bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
    onLoadMore,
  } = options;

  const scrollTop = ref(0);
  const viewportHeight = ref(0);

  // 重新读容器几何位置 + 触发区间重算（scroll / resize / items 变化时调用）。
  function measure() {
    const el = containerRef.value;
    if (!el) return;
    scrollTop.value = el.scrollTop;
    viewportHeight.value = el.clientHeight;
  }

  // 滚动事件：更新 scrollTop（区间靠 computed 自动重算）+ 滚到底检测。
  function onScroll() {
    const el = containerRef.value;
    if (!el) return;
    scrollTop.value = el.scrollTop;
    if (
      onLoadMore &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - bottomThreshold
    ) {
      onLoadMore();
    }
  }

  // 区间纯计算（响应式：依赖 scrollTop / viewportHeight / items.length）。
  const window = computed(() =>
    computeWindow(
      scrollTop.value,
      viewportHeight.value,
      items.value.length,
      itemHeight,
      overscan,
    ),
  );

  const visibleItems = computed(() =>
    items.value.slice(window.value.startIndex, window.value.endIndex),
  );

  let resizeObserver: ResizeObserver | null = null;

  onMounted(() => {
    const el = containerRef.value;
    if (!el) return;
    measure();
    // 容器尺寸变化（窗口缩放、侧栏开合）时重测视口高度。
    resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(el);
  });

  // items 变化（翻页追加、过滤、切 tab）后，新条目可能改变内容高度，
  // 但 itemHeight 固定，区间自动重算；需补一次 measure 以同步最新 scrollTop。
  watch(() => items.value.length, () => measure());

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return {
    /** 可见条目（已 slice，v-for 直接用）。 */
    visibleItems,
    /** 撑滚动条的总高（绑定到占位容器 style.height）。 */
    totalHeight: computed(() => window.value.totalHeight),
    /** 可见区 translateY 偏移（绑定到内层 style.transform）。 */
    offsetY: computed(() => window.value.offsetY),
    /** 滚动事件处理（绑定到容器 @scroll）。 */
    onScroll,
  };
}
