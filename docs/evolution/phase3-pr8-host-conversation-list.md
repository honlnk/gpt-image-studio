# 阶段三 PR8：宿主侧会话列表（嵌入态会话管理外移）

> 状态：⬜ 待启动
> 依赖：PR7（postMessage 通道 + URL 同步 + 高度修复 + 隐藏侧边栏开关已就位）
> 定位：PR7 解决"嵌入态基本可用"，本 PR 解决"嵌入态会话管理由宿主管"——把子应用自带的 ConversationSidebar 完全外移到宿主页面，宿主侧渲染会话列表、触发新建/删除/重命名/切换。

## 一、背景

PR7 默认隐藏了子应用侧边栏（`hideSidebarInEmbed`），但**只隐藏不外移**——嵌入态下用户没有任何会话管理入口（新建/切换/删除/重命名全没了）。完整嵌入形态应该是宿主页面承担会话列表 UI，子应用只负责对话工作区。

这是文档 PR7 §2.5 明确推迟的部分，也是用户最初诉求的核心："做一个聊天列表，嵌入到 qiankun 后禁用展示左侧边栏，历史记录列表放到宿主页面中"。

## 二、设计决策

### 2.1 数据流：读用 API、写委托子应用（已确认）

调研结论（Companion storage 路由调研）：

| 操作 | 执行方 | 理由 |
|---|---|---|
| 读列表 | **宿主直接调 Companion API** `GET /storage/conversations` | 数据权威，不依赖子应用内存状态，JWT 鉴权天然支持 |
| 切换会话 | postMessage → 子应用 | 子应用需同步草稿、消息加载、activeConversationId |
| 新建会话 | postMessage → 子应用 | 子应用的 createConversation 含 id 生成 + active 切换 + 草稿初始化编排 |
| 删除会话 | postMessage → 子应用 | 子应用的 deleteConversation 含 active 回落 + 草稿清理 + 消息级联；即时删除无确认——与子应用自带侧边栏的交互约定一致（曾短暂加过宿主侧 confirm，实测两次点击太繁琐后去掉） |
| 重命名会话 | postMessage → 子应用 | 复用子应用 renameConversation（含 confirm 弹窗 + 持久化） |

**为什么写不直接走 API**：直接 `DELETE /storage/conversations/:id` 不级联删消息（留孤儿）；直接 `PUT` 新建会话不会触发子应用的 active 切换和草稿初始化。子应用内存状态会与 DB 脱节。

### 2.2 双向 postMessage 协议扩展

PR7 只有单向（宿主→子应用）：`{type:'select-conversation', id}`。本 PR 扩展为双向：

**宿主 → 子应用**（扩展 `EmbeddedHostMessage`）：
```ts
| { type: "select-conversation"; id: string }      // PR7 已有
| { type: "create-conversation" }                   // 新建
| { type: "delete-conversation"; id: string }       // 删除（即时执行无确认，与子应用侧边栏行为一致）
| { type: "rename-conversation"; id: string }       // 触发重命名（子应用弹 RenameDialog）
| { type: "open-settings" }                         // 打开子应用设置弹窗（嵌入态配置只读但可查看）
```

**子应用 → 宿主**（新增方向）：
```ts
| { type: "conversations-changed" }                 // 列表内容变更（create/delete/rename 完成），通知宿主刷新列表
| { type: "active-conversation-changed"; id: string } // 激活会话变化（select/新建/删除回落/初始激活），通知宿主更新高亮
```

**为什么用"通知刷新"而非"子应用回传列表数据"**：
- 子应用写操作完成后，数据已落库，宿主重新 `GET /storage/conversations` 拿到的是 DB 真相，比子应用内存更权威。
- 避免子应用→宿主传大数据（会话列表可能很长），`conversations-changed` 只是个信号。
- 宿主刷新逻辑复用首次加载的同一套 fetch + 渲染。

**反向消息的发送时机**：
- `conversations-changed`：create/delete 操作完成后立即发；rename 在 **confirm 确认后**发——`renameConversation` 只打开 RenameDialog、立即返回，在 handler 里发会让宿主刷到旧标题（实施时实测发现的 bug）。
- `active-conversation-changed`：ViewModel 对 `activeConversationId` 的 watch 里单点发，覆盖 select/新建/删除回落/初始激活所有路径。select 不发 `conversations-changed`（列表内容没变），但激活态变化必须显式通知——原因见 §2.5。

### 2.3 子应用如何收到宿主的写指令

PR7 的 `conversationSwitcher` 桥接只处理 select。本 PR 升级为**多操作桥接**：

`embeddedBridge.ts` 的 `conversationSwitcher` 升级为 `hostActions` 对象：
```ts
let hostActions: {
  select?: (id: string) => void;
  create?: () => void;
  delete?: (id: string) => void;
  rename?: (id: string) => void;
} | null = null;

export function setHostActions(actions: typeof hostActions): void;
```

ViewModel onMounted 时注入全部操作（复用已有的 `switchToConversationIfValid` + sidebar 的 create/delete/rename），onUnmounted 置 null。

### 2.4 子应用如何发反向消息给宿主

qiankun JS 沙箱下，子应用与宿主共享 window（单页嵌入）。反向 postMessage：
```ts
window.postMessage({ type: "conversations-changed" }, window.location.origin);
```
宿主的 message 监听器收到后刷新列表。

封装到 `embeddedBridge.ts` 的 `notifyHostConversationsChanged()`，仅在 `__POWERED_BY_QIANKUN__` 时发送（独立态 no-op）。

### 2.5 宿主列表的选中态同步

会话列表需要高亮"当前激活会话"。**原设计**是宿主读自己地址栏的 `?c=` + 监听 `popstate`——**实施时验证此设计不成立**：子应用切换会话用 `pushState`/`replaceState` 写 URL，二者都**不触发 `popstate`**（popstate 只在浏览器前进/后退时触发），宿主监听地址栏感知不到激活变化。

**修正后**：激活态由子应用显式通知——`{type:'active-conversation-changed', id}`（§2.2），在 ViewModel 的 `activeConversationId` watch 里单点发出。宿主维护 `hostActiveConvId`，收到消息即重渲染高亮；`?c=` 只作回退（初始未收到消息时，如刷新恢复场景）。

附带解决一个竞态：宿主 `loadConversations` 在 qiankun MOUNTED 时触发，此刻子应用 hydrate 未完成、`?c=` 尚未写入地址栏，原设计下初始高亮必然落空；消息驱动后，子应用 hydrate 完成时的首次 watch 触发会发出初始激活 id，与宿主列表加载完成顺序无关。

## 三、改造清单

### 3.1 扩展 `src/services/embeddedBridge.ts`

- `EmbeddedHostMessage` 联合类型加 create/delete/rename 三种。
- `isEmbeddedHostMessage` 类型守卫覆盖新类型。
- `conversationSwitcher`（单一 select）升级为 `hostActions`（多操作对象）。
- 新增 `setHostActions(actions)` / `notifyHostConversationsChanged()`。
- 监听器按 `msg.type` 分发到对应 handler。

### 3.2 改 `src/app/studio/useStudioViewModel.ts`

- onMounted：`setHostActions({ select, create, delete, rename })` 注入四个操作。
  - select 复用 `switchToConversationIfValid`。
  - create/delete/rename 复用 sidebar 已暴露的 `studio.sidebar.*`，但写操作完成后调 `notifyHostConversationsChanged()`。
- onUnmounted：`setHostActions(null)`。

### 3.3 改 `examples/qiankun-host/index.html`

宿主页面新增左侧会话列表栏，布局变为「顶栏 + 左列表 + 右子应用容器」三栏：

```
┌─────────────────────────────────────────────┐
│ host-bar（顶栏，PR7 已有）                     │
├──────────┬──────────────────────────────────┤
│ 会话列表  │ #image-studio-container          │
│ (宿主渲染)│ (qiankun 子应用)                 │
│          │                                  │
│ + 新建   │                                  │
│ conv-1   │                                  │
│ conv-2 ● │  ← ● 高亮 = URL ?c= 当前          │
│ conv-3   │                                  │
└──────────┴──────────────────────────────────┘
```

宿主侧 JS 新增：
- `loadConversations()`：`GET /storage/conversations`（JWT），按 updatedAt 降序排，渲染列表。
- 列表项点击：`postMessage({type:'select-conversation', id})`（PR7 已有通道）。
- 新建按钮：`postMessage({type:'create-conversation'})`。
- 删除按钮：`postMessage({type:'delete-conversation', id})`（即时删除无确认，与子应用侧边栏一致）。
- 重命名按钮：`postMessage({type:'rename-conversation', id})`（RenameDialog 由子应用弹）。
- 设置按钮（新建按钮下方）：`postMessage({type:'open-settings'})` 打开子应用设置弹窗（嵌入态连接配置只读但可查看——补回 PR7 隐藏侧边栏时失去的设置入口）。
- message 监听：`conversations-changed` → `loadConversations()` 刷新；`active-conversation-changed` → 更新 `hostActiveConvId` 并重渲染高亮。
- 选中态：优先用消息维护的 `hostActiveConvId`，回退读 `location.search` 的 `?c=`；popstate（浏览器前进/后退）时清回 URL 驱动。

### 3.4 测试

- 更新 `src/services/embeddedBridge.test.ts`：
  - 新消息类型的守卫测试（create/delete/rename）。
  - `setHostActions` 多操作桥接测试。
  - `notifyHostConversationsChanged` / `notifyHostActiveConversationChanged` 测试（嵌入态发消息、独立态 no-op、空 id 原样发送）。
  - `isEmbeddedChildMessage` 覆盖两种子→宿消息类型。
- 宿主侧 JS 是纯静态 HTML，不进单测（手动验证）。

## 四、验收门槛

### 嵌入态（demo 手动验证）

- [ ] 宿主左侧显示会话列表，数据来自 Companion API（JWT 鉴权）
- [ ] 列表按 updatedAt 降序
- [ ] 点击列表项 → 子应用切换到该会话（postMessage select，PR7 通道）
- [ ] 宿主列表高亮跟随激活会话（子应用 select/新建/删除回落后发 `active-conversation-changed`；初始加载高亮正确）
- [ ] 新建按钮 → 子应用创建会话 → 子应用回发 conversations-changed → 宿主列表刷新出现新项且高亮到新会话
- [ ] 删除按钮 → 子应用即时删除（无确认，与子应用侧边栏一致）→ 回发通知 → 宿主列表刷新，项消失
- [ ] 重命名按钮 → 子应用弹 RenameDialog → **确认后**回发通知 → 宿主列表刷新为新标题（弹窗打开时不通知）
- [ ] 设置按钮 → 子应用打开设置弹窗（连接配置只读可见）
- [ ] 子应用侧边栏保持隐藏（hideSidebar:true）
- [ ] 高度无溢出（PR7 修复继续生效）

### 独立态回归

- [ ] 独立态行为完全不变（hostActions 注入对独立态无副作用，独立态不发反向消息）

## 五、回滚策略

| 改造点 | 回滚影响 |
|---|---|
| embeddedBridge 协议扩展 | 回滚后宿主只能 select，不能 create/delete/rename |
| ViewModel hostActions 注入 | 回滚后子应用不响应宿主写指令 |
| 宿主列表 UI | 回滚后宿主无列表，回到 PR7 的"隐藏侧边栏无管理入口"状态 |

各改造点向后兼容（select 消息 PR7 已支持），可分批合入。

## 六、为后续铺路

- **宿主列表的增强**：显示 summary、最后消息预览、未读数。需调 `GET /storage/messages` 客户端 filter。
- **真实 Vben 集成**：本 PR 的宿主列表是原生 HTML demo，Vben 集成时把 fetch + postMessage 逻辑搬到 Vben 组件，数据流不变。
- **子应用→宿主反向通信的通用化**：`conversations-changed` 与 `active-conversation-changed` 是首批反向消息，未来可扩展消息已读、错误上报等。

## 七、实施记录

> （PR 合并后填写）
