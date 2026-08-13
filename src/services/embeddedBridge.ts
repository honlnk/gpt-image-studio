/**
 * 嵌入态宿主↔子应用通信桥（阶段三 PR7 §2.3 + PR8 双向协议扩展）。
 *
 * qiankun 的 props 只在首次 mount 注入一次，props 后续变化不会热更新到子应用
 * store。宿主无法通过 props 动态指挥子应用，需要一条运行时通道——本模块用
 * `window.postMessage`。
 *
 * 协议分两个方向：
 * - **宿主→子应用**（`EmbeddedHostMessage`）：切换/新建/删除/重命名会话、打开设置。
 * - **子应用→宿主**（`EmbeddedChildMessage`）：列表内容变更（conversations-changed）
 *   与激活会话变化（active-conversation-changed）两种信号。
 *
 * 为什么不用 qiankun globalState / window 全局方法 / 共享 Pinia，见文档
 * `phase3-pr7-embed-experience.md` §2.3。postMessage 优势：浏览器原生、与微前端
 * 框架解耦、跨 origin 安全、双向通信天然支持。
 *
 * 分层约定（重要）：本模块是纯协议层——只负责消息类型守卫 + origin 校验 + 监听器
 * 生命周期 + 桥接 ref。**不依赖任何 Pinia store**。存在性校验、草稿同步等业务逻辑
 * 由注入方（ViewModel 通过 setHostActions）提供。
 */

// ─── 宿主→子应用的消息协议 ───

/** 宿主发给子应用的消息。PR7 只有 select，PR8 扩展 create/delete/rename/open-settings。 */
export type EmbeddedHostMessage =
  | { type: "select-conversation"; id: string }
  | { type: "create-conversation" }
  | { type: "delete-conversation"; id: string }
  | { type: "rename-conversation"; id: string }
  | { type: "open-settings" };

// ─── 子应用→宿主的消息协议（PR8 新增方向） ───

/** 子应用发给宿主的消息。 */
export type EmbeddedChildMessage =
  /** 会话列表内容已变更（create/delete/rename 完成）→ 宿主重新拉列表。 */
  | { type: "conversations-changed" }
  /** 当前激活会话已变化（select/新建/删除回落/初始激活）→ 宿主更新高亮。
   *  为什么需要它：子应用切换会话用 pushState/replaceState 写 URL，二者都
   *  不触发 popstate，宿主无法靠监听地址栏感知激活变化，必须显式通知。 */
  | { type: "active-conversation-changed"; id: string }
  /** 设置弹窗已关闭 → 宿主把 URL 从 /settings 清回会话态，
   *  否则 URL 停在 settings 后再次点击「设置」菜单（同 URL）不触发 watch、
   *  设置弹窗无法重新打开。 */
  | { type: "settings-closed" };

/** 子应用→宿主消息的类型白名单（供宿主侧监听器做类型守卫）。 */
const CHILD_MESSAGE_TYPES = new Set<EmbeddedChildMessage["type"]>([
  "conversations-changed",
  "active-conversation-changed",
  "settings-closed",
]);

/**
 * 类型守卫：校验宿主→子应用消息结构合法。
 * 防止恶意/无关页面乱发消息触发操作。
 */
function isEmbeddedHostMessage(data: unknown): data is EmbeddedHostMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as { type?: unknown; id?: unknown };
  switch (msg.type) {
    case "select-conversation":
    case "delete-conversation":
    case "rename-conversation":
      // 这三种需要 id 字段为字符串
      return typeof msg.id === "string";
    case "create-conversation":
    case "open-settings":
      // 无 payload
      return true;
    default:
      return false;
  }
}

/**
 * 类型守卫：校验子应用→宿主消息结构合法（供宿主侧监听器用）。
 * 注意：宿主是纯静态 HTML，不走本模块的 store 桥接，宿主侧的监听器在 demo
 * 的 index.html 里手写。此函数导出供未来 Vben 等宿主集成复用。
 */
export function isEmbeddedChildMessage(
  data: unknown,
): data is EmbeddedChildMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as { type?: unknown };
  return typeof msg.type === "string" && CHILD_MESSAGE_TYPES.has(
    msg.type as EmbeddedChildMessage["type"],
  );
}

// ─── 桥接：ViewModel 注入操作 handler，监听器调用 ───

/**
 * 宿主指令的处理函数集合。ViewModel 在 onMounted 时注入，onUnmounted 撤销。
 * 每个 handler 应自含存在性校验（不存在则 no-op），本模块不重复校验——
 * 保持协议层与业务层解耦。
 */
export interface HostActions {
  /** 切换到指定会话（含草稿同步）。 */
  select: (id: string) => void;
  /** 新建会话。 */
  create: () => void;
  /** 删除指定会话（直接执行，无确认弹窗——与子应用自带侧边栏的
   *  即时删除行为一致；子应用侧含 active 回落 + 草稿/消息级联清理）。 */
  delete: (id: string) => void;
  /** 打开重命名弹窗（RenameDialog）。注意：只打开弹窗、立即返回，
   *  重命名实际完成后的宿主通知在 confirm 流程里发，不要在此 handler 里发。 */
  rename: (id: string) => void;
  /** 打开设置弹窗。嵌入态下连接配置由宿主注入、面板只读，但用户可查看。 */
  openSettings: () => void;
}

/**
 * 模块级桥接。PR7 是单一 `conversationSwitcher`，PR8 升级为多操作对象。
 * 详见文档 phase3-pr7-embed-experience.md §2.3 桥接问题说明。
 */
let hostActions: HostActions | null = null;

// ─── 跨域 origin 白名单 ───

/**
 * 宿主允许的 origin 列表（跨域嵌入用）。
 *
 * 默认空数组——等价于仅允许同源（PR7/PR8 demo 的行为）。
 * 宿主跨域嵌入时通过 qiankun props.allowedOrigins 注入（见 main.ts 的 configureEmbedding）。
 * 配置后：接收方向同源放行；发送方向 targetOrigin 取与白名单的交集，避免泄漏给无关 origin。
 */
let allowedOrigins: string[] = [];

/**
 * 配置嵌入态跨域白名单。由 main.ts 在 qiankun mount(props) 时按
 * props.allowedOrigins 注入。可传空数组重置回"仅同源"。
 */
export function configureEmbedding(input: { allowedOrigins?: string[] }): void {
  const origins = input.allowedOrigins ?? [];
  allowedOrigins = origins
    .map((o) => {
      try {
        return new URL(o.trim()).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/** 判断 origin 是否被允许（同源或命中白名单）。 */
function isOriginAllowed(origin: string): boolean {
  return origin === window.location.origin || allowedOrigins.includes(origin);
}

/**
 * 为子应用→宿主消息挑选最安全的 targetOrigin。
 * - 命中白名单且唯一：用该精确 origin（最安全）
 * - 同源：用当前 origin（demo 既有行为）
 * - 无可匹配的安全 targetOrigin：回退 "*"（仅作向后兼容兜底，见函数注释）
 */
function pickTargetOrigin(): string {
  if (allowedOrigins.length === 1) return allowedOrigins[0];
  return window.location.origin;
}

/**
 * 注入/撤销宿主指令处理函数集合。
 *
 * ViewModel 在 onMounted 时调 `setHostActions(actions)`，onUnmounted 调
 * `setHostActions(null)`。
 */
export function setHostActions(actions: HostActions | null): void {
  hostActions = actions;
}

/** 供测试读取当前桥接值（生产代码不应调用）。 */
export function __getHostActionsForTest(): HostActions | null {
  return hostActions;
}

// ─── 子应用→宿主反向消息 ───

/**
 * 子应用通知宿主"会话列表已变更"（PR8 §2.2/§2.4）。
 *
 * 仅嵌入态发送（独立态 no-op）。宿主收到后重新 `GET /storage/conversations` 刷新列表。
 * 发送时机：create/delete/rename 完成、发消息触发自动标题更新后（后者在
 * generationStore.submitMessage）。select 不发（不改列表内容）。
 *
 * qiankun JS 沙箱下子应用与宿主共享 window，postMessage 到 window 即可被宿主监听器收到。
 */
export function notifyHostConversationsChanged(): void {
  if (!window.__POWERED_BY_QIANKUN__) return;
  const msg: EmbeddedChildMessage = { type: "conversations-changed" };
  window.postMessage(msg, pickTargetOrigin());
}

/**
 * 子应用通知宿主"当前激活会话已变化"（PR8 §2.5）。
 *
 * 仅嵌入态发送（独立态 no-op）。宿主收到后更新列表高亮。
 * 发送时机：ViewModel 对 activeConversationId 的 watch 里统一发——单点覆盖
 * select/新建/删除回落/初始激活所有路径。id 为空串表示无激活会话（全部删除后）。
 */
export function notifyHostActiveConversationChanged(id: string): void {
  if (!window.__POWERED_BY_QIANKUN__) return;
  const msg: EmbeddedChildMessage = { type: "active-conversation-changed", id };
  window.postMessage(msg, pickTargetOrigin());
}

/**
 * 子应用通知宿主"设置弹窗已关闭"。
 *
 * 仅嵌入态发送（独立态 no-op）。宿主收到后把 URL 从 /settings 清回会话态，
 * 避免 URL 停在 settings 后再次点击「设置」菜单（同 URL）不触发 watch、
 * 设置弹窗无法重新打开。
 */
export function notifyHostSettingsClosed(): void {
  if (!window.__POWERED_BY_QIANKUN__) return;
  const msg: EmbeddedChildMessage = { type: "settings-closed" };
  window.postMessage(msg, pickTargetOrigin());
}

// ─── 监听器注册 ───

/**
 * 注册宿主消息监听，返回卸载函数。
 *
 * 监听器内部三层守卫：
 * 1. `__POWERED_BY_QIANKUN__`——独立态忽略，避免独立运行时被其它脚本干扰。
 * 2. `event.source` 非空——postMessage 规范要求，过滤合成事件。
 * 3. origin 校验——同源放行；若宿主通过 `allowedOrigins` 注入了跨域白名单，则白名单内
 *    origin 也放行。默认（未配置白名单）等价于 PR7/PR8 demo 的"仅同源"行为，向后兼容。
 *
 * 通过三层守卫后，按 msg.type 分发到 hostActions 对应 handler。
 */
export function listenHostMessages(): () => void {
  const handler = (event: MessageEvent) => {
    if (!window.__POWERED_BY_QIANKUN__) return;
    if (!event.source) return;
    if (!isOriginAllowed(event.origin)) return;
    if (!isEmbeddedHostMessage(event.data)) return;
    if (!hostActions) return;
    const msg = event.data;
    switch (msg.type) {
      case "select-conversation":
        hostActions.select(msg.id);
        break;
      case "create-conversation":
        hostActions.create();
        break;
      case "delete-conversation":
        hostActions.delete(msg.id);
        break;
      case "rename-conversation":
        hostActions.rename(msg.id);
        break;
      case "open-settings":
        hostActions.openSettings();
        break;
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
