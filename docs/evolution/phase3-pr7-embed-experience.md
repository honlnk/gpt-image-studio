# 阶段三 PR7：嵌入态体验增强（URL 会话定位 + 宿主通信 + 高度修复）

> 状态：⬜ 待启动
> 依赖：PR5（qiankun 嵌入生命周期已就位，`isEmbedded` 标记已贯穿）
> 定位：phase3 PR5「前端 qiankun 嵌入改造」的能力补全——PR5 解决了"能不能嵌进来"，本 PR 解决"嵌进来之后好不好用"。
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三 D14「前端子项目化」+ roadmap §8

## 一、背景：当前嵌入态的三个短板

PR5 让子应用能被 qiankun 嵌入并拿到宿主配置，但嵌入态的实际可用性还有三个缺口：

### 1.1 刷新丢失当前对话

当前激活会话的逻辑在 `src/features/backup/useStudioRestore.ts:98-99`：

```ts
input.conversations.value = restoredConversations;
input.activeConversationId.value = restoredConversations[0]?.id ?? "";
```

恒取恢复后会话列表的**第一项**（按 `updatedAt` 降序，即最近更新的）。用户切到第 5 个会话后刷新，会被踢回第一个。URL 完全不记录当前对话。

**影响**：
- 独立态：刷新 / 分享链接 / 浏览器前进后退 都无法回到指定对话。
- 嵌入态：宿主无法通过 URL 指挥子应用定位到某个对话（多标签页、书签等场景失效）。

### 1.2 宿主无法外部控制子应用对话

qiankun 的 `props` **只在首次 `mount(props)` 时注入一次**（`src/main.ts:135-137` 的 `mount` 调 `render(props)`，`render` 内一次性读取 props）。props 后续变化不会热更新到子应用 store。

因此"宿主侧渲染会话列表、点击切换子应用对话"这条最自然的嵌入交互链路当前走不通——宿主点击事件没有通道传到子应用的 `selectConversation`。

### 1.3 嵌入态高度溢出

根因链：
- `index.html` 的 `<html>/<body>/<div#app>` 都没有 `height:100%`（已 grep 确认）。
- 独立态靠 `src/components/studio/StudioShell.vue:20` 的 `h-screen`（=100vh）兜底撑满视口。
- 嵌入态下，子应用被挂进宿主容器（`#image-studio-container`），`100vh` 取的是**宿主视口高度**，而非容器高度。叠加宿主顶栏后，子应用底部溢出宿主可视区，出现滚动条 / 内容被裁切。

## 二、设计决策

### 2.1 URL 形式：query 参数 `?c=<conversationId>`

**决策**：用 `?c=<id>` query 参数，不用 hash、不用 pathname。

**对比被否方案**：
- ❌ hash（`#c=<id>`）：不进服务器日志、SPA 友好，但项目当前**完全不用 hash**，是全新引入，与现状割裂。
- ❌ pathname（`/c/<id>`）：语义最清晰，但需要服务器 SPA fallback 配置（GH Pages 有 404.html 可复用，Companion/Nginx 部署也要配），**且与 qiankun 的 `activeRule` 高度冲突**——qiankun 靠 pathname 匹配子应用，子应用内部再用 pathname 记对话会扰乱激活规则。

**与现有 URL 参数的关系**：`src/services/urlSettings.ts` 已有 `URL_SETTING_KEYS`（apiUrl/apiKey/model 等），但那些是**"一次性消费后擦除"**的设置注入参数（`applyUrlSettings` 在 `useStudioViewModel.ts:398` 消费后调 `clearUrlSettingParams` + `replaceState` 擦掉）。对话 id 语义不同——它要**持久保留**在 URL 上，反映"当前状态"。因此不并入 `URL_SETTING_KEYS`，独立成 `conversationUrl.ts`。

### 2.2 URL 写策略：主动切换 `pushState` + 兜底同步 `replaceState` + `popstate` 恢复

**目标**：既要"刷新/分享定位"，也要"浏览器前进/后退在会话间回退"。纯 `replaceState` 不产生历史条目，后退会直接离开应用——两个目标不可兼得，故采用混合策略。

**写（两条路径）**：
- **用户主动切换**（点侧边栏、嵌入态 postMessage 切换）：`history.pushState` 进历史栈 → 后退可逐会话回退。push 去重条件：目标 id ≠ **URL 当前值**（不是 ≠ 当前激活 id）——popstate 恢复触发的切换，URL 已是目标值，据此判断不会再 push，否则按一次后退就压一条新记录、"前进"永远失效。
- **兜底同步**（首次激活落 URL、删除当前会话后回落、新建会话、以及任何未走主动切换路径的激活变化）：`history.replaceState` 只更新当前条目，不污染历史栈。删除回落**必须** replace——被删会话的历史条目已失效，不应再产生新条目；新建会话视为"开新文档"而非"导航"，也走 replace。

**读**：
- 首次激活（`useStudioRestore.ts:99`）：优先读 URL 的 `?c=`，校验存在则用之，否则回落第一个。
- `popstate`（浏览器前进/后退）：监听器读 URL，若与当前不同且存在于列表则切换（复用 `selectConversationWithDraft`，内部 push 去重保证不重复进栈）。

**校验**：URL 里的 id 必须存在于当前会话列表才采用，否则静默回落。遵循 D1 数据集隔离——URL 指向的可能是其它后端/已删除的对话，无效 id 不报错、不提示，直接用列表第一项。回退到已删除会话的历史条目时同样走此校验：静默回落，URL 由兜底 replace 同步。

**已知代价**：切换 N 次会话后需按 N 次后退才离开应用。这是启用回退的固有代价，与文档型应用（Notion / Google Docs）的会话导航行为一致，可接受。

**嵌入态补充：URL 是子应用与宿主共享的**

qiankun 的 JS 沙箱**不隔离 `location`/`history`**——一个页面只有一个地址栏，嵌入态下子应用读写的 URL 就是宿主页面的地址栏。含义：

- **写侧**：子应用 push/replace `?c=` 修改的是宿主地址栏。`writeConversationIdToUrl` 保留其它 query 参数，与宿主自身参数共存；但若宿主 URL 上恰好有 `c` 键（如宿主自己的 `?c=category`），会互相覆盖——真实宿主集成时需约定键名避让（demo 同源单页场景无冲突）。
- **读侧**：`useStudioRestore` 读到的是宿主 URL。宿主 URL 上无关的 `c` 值会被存在性校验挡下、静默回落，行为安全。
- **popstate**：宿主自身路由导航也会触发子应用的 popstate 监听；读到无 `c` 或无匹配时不动作，存在性校验天然兜底。
- **正向价值**：共享 URL 同时充当"宿主感知子应用当前会话"的隐式通道——宿主摸不到子应用的 Pinia store，但可以读自己地址栏的 `?c=`（§3.9 的演示按钮即依赖此拿到有效会话 id）。未来由反向消息 `{type:'conversation-changed', id}`（见 §七）替代后，再评估是否禁用嵌入态 URL 写。

### 2.3 宿主→子应用通道：postMessage

**决策**：用 `window.postMessage` + 子应用 `message` 监听，不依赖 qiankun 专属 API。

**消息协议**：
```ts
// 宿主 → 子应用
{ type: "select-conversation"; id: string }
```

**对比被否方案**：
- ❌ qiankun `initGlobalState`：能力全但引入 qiankun 专属 API，本项目当前未集成，且换其它微前端框架（wujie/micro-app）时通道要重写。
- ❌ `window[appName].selectConversation` 全局方法：最简单但破坏封装，污染全局命名空间，且与 `main.ts:149-152` 已挂的 lifecycle 对象混在一起易混淆。
- ❌ 共享 Pinia 实例：耦合最重，子应用与宿主强绑定一个 store 实例，违反"子应用自治"原则。

**postMessage 的优势**：
- 浏览器原生、与微前端框架解耦、未来换 wujie/micro-app/iframe 方案都通用。
- 跨 origin 安全（`event.origin` 校验）。
- 双向通信天然支持（未来子应用→宿主可同通道反向发）。

**关键桥接问题**：`selectConversationWithDraft`（带草稿串行队列 + 埋点，`useStudioViewModel.ts:478`）在 ViewModel 内部，而 message 监听必须在 Vue 应用外（`main.ts`）。需要一个桥接：
- 在 `embeddedBridge.ts` 维护模块级 `let conversationSwitcher: ((id: string) => void) | null`。
- ViewModel `onMounted` 时赋值 `conversationSwitcher = selectConversationWithDraft`，`onUnmounted` 置 null。
- `main.ts` 的 message 监听器调 `conversationSwitcher?.(id)`。

这是必要的妥协：监听器生命周期与 Vue app 不同步（监听器在 `mount` 注册、`unmount` 卸载，但 store 实例随 `createApp` 一起销毁），模块级 ref 是最轻量的桥接，比 provide/inject 穿透 main.ts 边界简单。

**pinia 实例提升**：当前 `render()` 内的 `const pinia = createPinia()`（`main.ts:52`）是局部变量，message 监听器拿不到 store。改为模块级 `let piniaInstance: Pinia | null`，`render` 赋值、`unmount` 置 null。监听器通过 `useConversationsStore(piniaInstance)` 拿 store（仅用于校验 id 存在性；实际切换走 `conversationSwitcher` 桥接）。

### 2.4 高度修复：嵌入态改 `h-full` + 容器高度链

**根因**：独立态靠 `h-screen`（视口高度）兜底，因为 `html/body/#app` 无 `height:100%`。嵌入态不能继续用视口高度。

**方案**：
1. `src/style.css` 追加嵌入态高度兜底（用 class 标记，不用 `:has()` 保兼容性）：
   ```css
   html.__embedded__, html.__embedded__ body { height: 100%; }
   ```
   注：嵌入态 Vue mount 到宿主容器（`#image-studio-container`），DOM 中**不存在 `#app`**，原高度链的 `#app` 选择器不命中；且宿主容器定为固定像素高度（`calc(100vh - 顶栏高)`，见第 4 条）后，`h-full` 的父链只需容器有确定高度，此 CSS 仅作"宿主容器改用百分比高度"场景的防御。
1a. **qiankun wrapper 中间层**（实施时实测发现）：qiankun 挂载会在宿主容器内再包一层 `<div id="__qiankun_microapp_wrapper_for_<appName>">`，Vue 根节点 mount 进 wrapper 而非直接挂宿主容器。wrapper 无高度样式（height:auto 由内容撑开），`<main> h-full` 的父链在这一环断裂——实测 wrapper 高度 = 内容高度（570px）而非容器高度。需在 `style.css` 追加：
   ```css
   html.__embedded__ [id^="__qiankun_microapp_wrapper_for_"] { height: 100%; }
   ```
   （子应用的 bundle CSS 由 `injectEmbeddedCss` 注入宿主真实 document.head，在全局作用域，可覆盖到 wrapper——与沙箱开关无关。demo 宿主现用 `sandbox: false`，见 `examples/qiankun-host/index.html` 注释。）
2. `main.ts` 嵌入态在 `render()` 加 `document.documentElement.classList.add('__embedded__')`，`unmount` 时 remove。
3. `StudioShell.vue:20` 根节点条件类：嵌入态 `h-full`（撑满容器），独立态 `h-screen`（撑满视口）。
4. 宿主容器（`examples/qiankun-host/index.html` 的 `#image-studio-container`）高度改为 `calc(100vh - <顶栏高度>)`，精确填满顶栏以下空间。

**为什么不用 `100dvh` / `min-h-screen`**：`dvh` 移动端动态视口对本场景（嵌入桌面后台）无收益；`min-h-screen` 仍取视口高度，不解决根因。核心是让子应用高度由**容器**决定，而非视口。

### 2.5 嵌入态隐藏侧边栏

**决策**：本轮只做"隐藏子应用自带侧边栏"开关，会话列表**暂不外移**到宿主。

**理由**：会话列表数据在子应用 `conversationsStore`（Pinia），宿主无法直接读。外移意味着宿主要自己调 Companion API（`/storage/conversations`）渲染列表 + 维护选中态同步，工作量大且职责切割需要更多设计。本轮先打通"URL 定位 + 通信通道 + 高度"，让嵌入态基本可用；会话列表外移作为后续 PR。

**实现**：
- `settingsStore` 新增 `hideSidebarInEmbed` ref（默认 `true`，嵌入态默认隐藏）。
- `QiankunProps` 扩展 `hideSidebar?: boolean`，宿主可通过 props 控制。
- `StudioShell.vue` 的 `<ConversationSidebar>` 加 `v-if="!(settings.isEmbedded && settings.hideSidebarInEmbed)"`。

> 注意：隐藏侧边栏后，新建/删除/重命名会话的入口、以及**设置弹窗入口**（`@open-settings` 挂在侧边栏上，`StudioShell.vue:25`）都会消失。会话管理能力在嵌入态下应由宿主提供（宿主有自己的会话管理 UI）；设置入口消失可接受——`isEmbedded` 本就禁用设置编辑与持久化，但记入已知限制：嵌入态下用户无法查看当前连接配置。本轮 demo 不实现宿主侧会话管理 UI，只验证隐藏开关生效。（后续：PR8 已在宿主侧边栏补回会话管理与设置入口，设置经 `open-settings` 消息打开子应用设置弹窗。）

## 三、改造清单

### 3.1 新增 `src/services/conversationUrl.ts`

封装 URL ↔ 对话 id 的读写（参考 `urlSettings.ts` 的可注入 `location`/`history` 范式，便于单测）：

```ts
const CONVERSATION_QUERY_KEY = "c";

export function readConversationIdFromUrl(
  location: Pick<Location, "search"> = window.location,
): string | null;

export function writeConversationIdToUrl(
  id: string,
  mode: "push" | "replace" = "replace",
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "replaceState" | "pushState"> = window.history,
): void;
```

`writeConversationIdToUrl` 保留 URL 上其它参数（如 urlSettings 尚未消费的参数），只增删 `c` 键。`mode` 语义见 §2.2：`"push"` 仅用于用户主动切换（进历史栈，可后退回退），`"replace"` 用于一切兜底同步（默认，不污染历史栈）。

### 3.2 新增 `src/services/embeddedBridge.ts`

封装 postMessage 协议 + 桥接 ref：

```ts
export type EmbeddedHostMessage =
  | { type: "select-conversation"; id: string };

// 模块级桥接：ViewModel 赋值，main.ts 监听器调用
let conversationSwitcher: ((id: string) => void) | null = null;
export function setConversationSwitcher(fn: ((id: string) => void) | null): void;

export function listenHostMessages(): () => void;  // 返回卸载函数
```

监听器内部：
- 仅 `__POWERED_BY_QIANKUN__` 时响应（独立态忽略）。
- 校验 `event.origin === window.location.origin`（同源嵌入，对应 §2.3 优势中的 origin 安全）+ `event.source` 非空 + 消息结构合法。
- 调 `conversationSwitcher?.(id)`（ViewModel 注入的 `selectConversationWithDraft`）。

### 3.3 改 `src/features/backup/useStudioRestore.ts`

行 98-99，首次激活优先读 URL：

```ts
input.conversations.value = restoredConversations;
const urlId = readConversationIdFromUrl();
const exists = urlId && restoredConversations.some(c => c.id === urlId);
input.activeConversationId.value = exists ? urlId! : (restoredConversations[0]?.id ?? "");
```

### 3.4 改 `src/app/studio/useStudioViewModel.ts`

四处改动：

1. **兜底同步（replace）**：新增 `watch(conversations.activeConversationId, ...)` 单点回写——任何路径（选择/新建/删除回落/popstate 恢复）导致激活变化，若与 URL 当前值不一致则 `writeConversationIdToUrl(id ?? "", "replace")`。这覆盖了 `selectConversationWithDraft` 之外的两条路径：新建会话、`deleteConversationsWithDraft`（行 641）删除当前会话后的回落。
2. **主动切换（push）**：`selectConversationWithDraft`（行 478-482）内追加——目标 id ≠ URL 当前值时 `writeConversationIdToUrl(id, "push")`。去重比较对象是 **URL 当前值**而非激活 id：popstate 恢复触发的切换 URL 已是目标值，不会重复进栈（否则按一次后退就压新记录，"前进"失效）。
3. **`onMounted` 同步部分**（不是 `.then` 回调内——hydration 走 catch 分支时监听仍需可用）：注册 `popstate` 监听 + `setConversationSwitcher(selectConversationWithDraft)`。
4. **`onUnmounted`**：移除 `popstate` 监听 + `setConversationSwitcher(null)`。

`popstate` 监听器：读 URL，若 id 与当前激活不同且存在于列表，调 `selectConversationWithDraft(id)`（复用，自带草稿同步 + 埋点 + 上述 push 去重）。

### 3.5 改 `src/main.ts`

1. pinia 实例提到模块级 `let piniaInstance: Pinia | null = null`，`render` 赋值、`unmount` 置 null。
2. `QiankunProps` 加 `hideSidebar?: boolean`。
3. `render(props)` 嵌入态分支：调 `listenHostMessages()` 注册监听（返回卸载函数存模块级，`unmount` 时调）；加 `__embedded__` class 标记。
4. `applyEmbeddedConfig` 透传 `hideSidebar` 到 settingsStore。
5. `unmount()` 清理顺序显式固定（qiankun 沙箱不会自动清理真实 window 上的监听器——demo 的"重新挂载"是 `location.reload()` 掩盖了这一点，真实宿主用 `loadMicroApp` 反复挂载时漏一步就叠加）：先调 message 监听卸载函数 → `app.unmount()`（触发 ViewModel `onUnmounted`：移除 popstate、`setConversationSwitcher(null)`）→ 移除 `__embedded__` class → `piniaInstance = null`。

### 3.6 改 `src/stores/settingsStore.ts`

新增 `hideSidebarInEmbed` ref（默认 `true`），`applyEmbeddedConfig` 接收并设置。

### 3.7 改 `src/components/studio/StudioShell.vue`

- `<main>` 根节点：`:class="['flex bg-white text-gray-900 antialiased', settings.isEmbedded ? 'h-full' : 'h-screen']"`。
- `<ConversationSidebar>`：加 `v-if="!(settings.isEmbedded && settings.hideSidebarInEmbed)"`。

### 3.8 改 `src/style.css`

追加嵌入态高度链（见 §2.4）。

### 3.9 改 `examples/qiankun-host/index.html` + `config.example.json`

- `#image-studio-container` 高度改 `calc(100vh - <顶栏高度>)`（顶栏高度用 CSS 变量或硬编码 48px）。
- 新增"模拟外部切换"演示按钮：宿主从**自己地址栏**读 `?c=` 拿到子应用当前会话 id（嵌入态 URL 共享，见 §2.2 嵌入态补充），`postMessage({type:'select-conversation', id}, location.origin)` 验证通道连通；`config.json` 可提供 `demoConversationId` 指定一个目标会话，演示真实的跨会话切换。
- `config.example.json` + README 补 `hideSidebar` 选项说明。

### 3.10 测试

- **新增** `src/services/conversationUrl.test.ts`：`readConversationIdFromUrl` / `writeConversationIdToUrl`（注入 fake location/history，覆盖空/有值/特殊字符/保留其它参数/`push` 与 `replace` 两种 mode 分别调用对应 history 方法）。
- **新增** `src/services/embeddedBridge.test.ts`：`listenHostMessages`（消息类型校验、origin 校验、`__POWERED_BY_QIANKUN__` 守卫、卸载）、`setConversationSwitcher` 桥接。注意 jsdom 坑：`window.postMessage` 派发的 MessageEvent `source` 为 null，会全挂在 source 守卫上——用例须手动构造 `new MessageEvent("message", { data, origin: window.location.origin, source: window })` 再 `window.dispatchEvent`。
- **更新** `src/qiankun-embed.test.ts`：补 postMessage 通道契约 + `hideSidebar` props 契约 + `conversationUrl` 在 restore 的集成契约（沿用该文件现有的源码字符串匹配风格，仅作防回归脚手架；行为保障由上面两个行为测试承担）。

## 四、验收门槛

### 独立态回归（不能破）

- [ ] `pnpm dev` 独立运行，切换会话 → URL 变 `?c=<id>`，刷新回到同一会话
- [ ] 连续切换多个会话后，浏览器**后退逐会话回退、前进逐会话恢复**（方案 B：主动切换 `pushState`）
- [ ] 回退到已删除会话的历史条目时，静默回落到有效会话，不报错
- [ ] 新建会话 / 删除当前会话后 URL 同步正确，且不产生多余历史条目（兜底走 `replaceState`）
- [ ] 无 `?c=` 时行为同改造前（回落第一个会话）
- [ ] `?c=<无效id>` 时静默回落第一个，不报错
- [ ] `pnpm typecheck` + `pnpm typecheck:companion` 无错
- [ ] `pnpm test` 全绿（含新增测试）

### 嵌入态（qiankun demo 手动验证）

- [ ] 子应用填满宿主容器，无溢出（高度 = 顶栏以下空间，非视口高度）
- [ ] 宿主 `postMessage({type:'select-conversation', id:<有效id>})` → 子应用切换到该会话
- [ ] 子应用内切换会话（含 postMessage 触发）→ **宿主地址栏**同步显示 `?c=`（嵌入态 URL 共享的预期行为，见 §2.2 嵌入态补充）
- [ ] `hideSidebar: true`（默认）→ 子应用自带侧边栏隐藏
- [ ] `hideSidebar: false` → 子应用侧边栏显示
- [ ] 嵌入态刷新宿主页 → 子应用按 URL `?c=` 恢复对话

### 部署文档同步

- [ ] `examples/README.md` 更新 demo 用法（postMessage 演示 + hideSidebar）
- [ ] `docs/deployment-guide.md` 视情况补充嵌入态通信协议说明

## 五、回滚策略

改造点彼此独立，可分批合入 / 回滚：

| 改造点 | 回滚影响 |
|---|---|
| conversationUrl（URL 同步） | 回滚后回到"刷新回到第一个会话"，独立态行为不变 |
| embeddedBridge（postMessage） | 回滚后宿主无法外部切换，但嵌入态基本功能不受影响 |
| 高度修复 | 回滚后嵌入态恢复溢出（独立态不受影响） |
| 隐藏侧边栏 | 回滚后嵌入态侧边栏恒显 |

最坏情况：全部回滚，回到 PR5 完成态（嵌入态可用但体验粗糙）。

## 六、不引入 vue-router / Vben 的理由

### vue-router

- 项目现状零 router（AGENTS.md 明确"only runtime dependency beyond Vue is Pinia"）。
- 本轮需求是 URL query 双向同步（含前进/后退回退），`history.pushState`/`replaceState` + `popstate` 足够，与 `urlSettings.ts` 现有范式一致。
- 阶段四 APP 化是单页形态，无路由概念，引入 router 与未来形态冲突。

### Vben demo

- 现有 `examples/qiankun-host/index.html` 定位是"最小集成验证夹具"（纯静态单文件）。
- Vben 是重量级框架（路由/权限/菜单/主题体系），即便精简也带来可观体积和构建链，与 examples/ "极简本地宿主"定位冲突。
- 本轮增强现有 index.html 即可验证所有改造点；真实 Vben 集成验证另开仓库。

## 七、为后续铺路

- **会话列表外移到宿主**：本轮打通的 postMessage 通道是基础。后续宿主侧渲染会话列表时，选中态切换直接复用 `{type:'select-conversation', id}` 消息；宿主列表数据可调 Companion `/storage/conversations`（JWT 鉴权）获取。
- **子应用→宿主反向通信**：postMessage 是双向的。未来子应用切换会话时可反向通知宿主（如 `{type:'conversation-changed', id}`），让宿主列表高亮同步。本轮不做，但通道已就位。
- **多对话标签页**：URL 定位 + 容器化高度修复后，宿主可开多个 tab 各嵌一个子应用实例，每个 tab 用不同 `?c=` 定位不同对话。

## 八、实施记录

> （PR 合并后填写）
