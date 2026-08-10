# 将 gpt-image-studio 嵌入你的管理系统（qiankun 集成指南）

> 本指南面向**宿主系统开发者**——如果你想把 gpt-image-studio 作为子应用嵌入到自己的管理后台（或任何前端项目）中，照着本文走即可完成集成。
>
> 本文基于一次完整的真实集成（嵌入 Vben Admin 5.x 管理后台）提炼而成，涵盖从「挂载子应用」到「会话菜单同步、高度适配、模态框层级、重复点击」等所有踩过的坑和解法。

---

## 目录

- [一、它能做到什么](#一它能做到什么)
- [二、整体架构](#二整体架构)
- [三、前置准备](#三前置准备)
- [四、宿主端集成（Step by Step）](#四宿主端集成step-by-step)
  - [Step 1 安装 qiankun](#step-1-安装-qiankun)
  - [Step 2 环境变量与子应用入口](#step-2-环境变量与子应用入口)
  - [Step 3 路由定义](#step-3-路由定义)
  - [Step 4 工作台页面（挂载子应用）](#step-4-工作台页面挂载子应用)
  - [Step 5 高度链适配（关键，必读）](#step-5-高度链适配关键必读)
  - [Step 6 通信桥（postMessage 协议封装）](#step-6-通信桥postmessage-协议封装)
  - [Step 7 会话列表拉取与菜单同步](#step-7-会话列表拉取与菜单同步)
  - [Step 8 路由守卫（keepAlive + 页签合并）](#step-8-路由守卫keepalive--页签合并)
- [五、子应用已内置的机制（无需你改，但需理解）](#五子应用已内置的机制无需你改但需理解)
- [六、通信协议速查](#六通信协议速查)
- [七、常见坑与解法（实战总结）](#七常见坑与解法实战总结)
- [八、快速验收清单](#八快速验收清单)

---

## 一、它能做到什么

嵌入后，用户在你的管理后台内即可获得完整的 AI 图片创作工作台：

- **文生图 / 图片编辑 / 遮罩编辑**——创作能力与独立版完全一致
- **多会话管理**——每个用户独立的会话历史，按用户物理隔离
- **会话列表进你的侧边栏菜单**——看起来像你的系统原生功能，而非「套了个 iframe」
- **删 / 改 / 新建会话**——操作入口可由子应用 header 或你的菜单承载
- **设置弹窗**——子应用的设置面板（连接配置只读，由宿主管控）

子应用与宿主共享同一个 `window`（qiankun div 挂载，非 iframe），通过 `window.postMessage` 双向通信，宿主掌控会话管理的呈现层，子应用负责创作画布。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│  你的管理后台（宿主，例如 Vben Admin / 任意 Vue 项目）        │
│                                                         │
│  ┌──────────┐   ┌──────────────────────────────────┐   │
│  │ 侧边栏菜单 │   │  内容区                           │   │
│  │ 「AI 创作」│   │  ┌──────────────────────────┐    │   │
│  │  ├ 新建   │   │  │  qiankun 子应用容器        │    │   │
│  │  ├ 设置   │   │  │  gpt-image-studio         │    │   │
│  │  ├ 会话A  │──▶│  │  （隐藏自带侧边栏）         │    │   │
│  │  ├ 会话B  │   │  │  创作画布 + header 删改按钮 │    │   │
│  │  └ 归档   │   │  └──────────────────────────┘    │   │
│  └──────────┘   └──────────────────────────────────┘   │
└────────┬───────────────────────┬───────────────────────┘
         │ HTTP（签发 JWT）        │ postMessage（会话同步）
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌────────────────────────────────┐
│ 你的后端 API     │     │ Companion 微服务                 │
│ 签发 Companion  │────▶│ 会话/消息/图片存储（按用户隔离）   │
│ JWT (HS256)     │     │ 图片生成代理                     │
└─────────────────┘     └────────────────────────────────┘
```

**三条通信链路：**

| 链路 | 方向 | 用途 |
|------|------|------|
| 宿主 ↔ 子应用 | 双向 | 会话选中/新建/删除/重命名/打开设置、激活变更/列表变更/设置关闭通知 |
| 子应用 → Companion | 直连 | 图片生成、会话/消息/图片读写（Bearer JWT） |
| 宿主后端 → Companion | 服务端 | 签发 JWT、可选代理管理 API |

---

## 三、前置准备

### 3.1 部署 Companion 微服务

gpt-image-studio 的创作数据（会话/消息/图片）存在 **Companion** 微服务中。嵌入态强制走 Companion 模式。

```bash
docker run -d --name companion -p 19751:19751 \
  -e JWT_SECRET=<你的密钥> \
  -e ADMIN_API_KEY=<管理密钥> \
  -e COMPANION_DEPLOYMENT_MODE=server \
  ghcr.io/honlnk/gpt-image-studio-companion:latest \
  node companion/dist/main.js serve --host 0.0.0.0 --port 19751 \
  --deployment-mode server \
  --allow-origin https://你的后台域名
```

详见 [Companion 部署文档](../companion/companion.md) 和 [部署指南](deployment-guide.md)。

### 3.2 后端签发 Companion JWT

Companion 只验不签 JWT（HS256 共享密钥），需要你的后端充当身份提供者签发。JWT payload 结构：

```json
{
  "sub": "用户ID",
  "display_name": "用户名",
  "iat": 1700000000,
  "exp": 1700007200,
  "jti": "唯一标识"
}
```

建议有效期 2 小时，过期重新签发。密钥（`JWT_SECRET`）必须与 Companion 容器的 `JWT_SECRET` 一致。

> ⚠️ **不要复用你系统的登录 token 当 Companion JWT**——结构和生命周期不同，单独签一个精简 JWT 更干净。

### 3.3 部署子应用静态产物

qiankun 需要一个可访问的 URL 指向 gpt-image-studio 的构建产物（`dist/`）。用 nginx 或静态托管部署到任意可访问地址，例如 `https://studio.your-domain.com`。

> 子应用的 `vite.config.ts` 用 `base: '/'`（绝对路径），因此必须用独立域名/子域名部署，**不要**用子路径（会 404）。

---

## 四、宿主端集成（Step by Step）

以下以 **Vue 3 + Vue Router** 项目为例。Vben Admin 特有的细节会单独标注。

### Step 1 安装 qiankun

```bash
pnpm add qiankun
# 或 npm install qiankun
```

子应用本身**不需要**安装 qiankun——它的 lifecycle 是手写的，与 qiankun 运行时解耦。qiankun 只装在宿主。

### Step 2 环境变量与子应用入口

```bash
# .env.development（本地联调，指向你本地 build + serve 的产物）
VITE_STUDIO_ENTRY=http://localhost:8899

# .env.production（生产，指向线上静态托管）
VITE_STUDIO_ENTRY=https://studio.your-domain.com
```

本地联调时，在子应用仓库 `pnpm build && npx serve -C -l 8899 dist` 即可。

### Step 3 路由定义

```ts
// src/router/routes/modules/studio.ts
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: { icon: 'lucide:sparkles', order: 25, title: 'AI 创作' },
    name: 'Studio',
    path: '/studio',
    children: [
      {
        name: 'StudioWorkspace',
        // :id? 用 path 参数承载会话 id；'settings' 是保留字
        path: '/studio/workspace/:id?',
        component: () => import('#/views/studio/workspace.vue'),
        meta: {
          title: '创作工作台',
          hideInMenu: true,   // 静态项隐藏，菜单由 studioMenu.ts 动态注入
          keepAlive: true,    // ⚠️ 关键：切 tab 不卸载子应用
        },
      },
      {
        name: 'StudioArchive',
        path: '/studio/archive',
        component: () => import('#/views/studio/archive.vue'),
        meta: { icon: 'lucide:archive', title: '会话归档' },
      },
    ],
  },
];

export default routes;
```

**为什么用 `:id?` path 参数而不是 query？** 因为菜单高亮按 path 严格匹配；用 query 会导致菜单选中态、页签合并等一系列问题。

### Step 4 工作台页面（挂载子应用）

这是核心页面，负责挂载/卸载 qiankun 子应用、桥接通信、同步 URL。

```vue
<!-- src/views/studio/workspace.vue -->
<script setup lang="ts">
import { loadMicroApp } from 'qiankun';
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConversationBridge } from './composables/useConversationBridge';
import { getCompanionToken, fetchRecentConversations, syncStudioMenus } from './studioMenu';

const SETTINGS_ID = 'settings';
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const containerRef = ref<HTMLElement>();
const entryUrl = import.meta.env.VITE_STUDIO_ENTRY || 'https://image.honlnk.com';
let microApp: ReturnType<typeof loadMicroApp> | null = null;

// 子应用报告的状态
const childActiveId = ref('');
const childReady = ref(false);

// ── 通信桥 ──
const bridge = useConversationBridge([location.origin], {
  onConversationsChanged: () => refreshMenus(),
  onActiveConversationChanged: (id) => onChildActiveChanged(id),
  onSettingsClosed: () => {
    // 子应用设置弹窗关闭 → 把 URL 从 /settings 清回会话态
    if (currentId() === SETTINGS_ID) {
      router.replace({
        path: childActiveId.value ? `/studio/workspace/${childActiveId.value}` : '/studio/workspace',
        query: { ...route.query },
      });
    }
  },
});

function currentId() { return (route.params.id as string) ?? ''; }

function refreshMenus() { void syncStudioMenus(); }

function onChildActiveChanged(id: string) {
  childActiveId.value = id;
  if (!childReady.value) {
    childReady.value = true;  // 首条消息 = 子应用就绪
    dispatchInitialIntent();
  } else {
    syncUrlToActive(id);
  }
}

function syncUrlToActive(id: string) {
  if (currentId() === SETTINGS_ID || currentId() === id) return;
  router.replace({ path: `/studio/workspace/${id}`, query: { ...route.query } });
}

// ── 路由变化 → 发指令给子应用 ──
watch(() => route.params.id, (raw) => {
  if (!childReady.value) return;
  const id = (raw as string) ?? '';
  if (id === SETTINGS_ID) {
    bridge.sendToChild({ type: 'open-settings' });
  } else if (id && id !== childActiveId.value) {
    bridge.sendToChild({ type: 'select-conversation', id });
  } else if (!id && childActiveId.value) {
    bridge.sendToChild({ type: 'create-conversation' });
  }
});

function dispatchInitialIntent() {
  const id = currentId();
  if (id === SETTINGS_ID) {
    bridge.sendToChild({ type: 'open-settings' });
  } else if (id && id !== childActiveId.value) {
    // 子应用 select 自带存在性校验，数据未就绪会 no-op → 带重试
    selectWithRetry(id);
  }
}

function selectWithRetry(targetId: string, attempt = 0) {
  if (childActiveId.value === targetId) return;
  bridge.sendToChild({ type: 'select-conversation', id: targetId });
  if (attempt < 5) {
    setTimeout(() => selectWithRetry(targetId, attempt + 1), 600);
  }
}

// ── 生命周期 ──
onMounted(async () => {
  try {
    const tokenVo = await getCompanionToken();  // 调后端拿 JWT + companionUrl
    await fetchRecentConversations().catch(() => {});

    microApp = loadMicroApp({
      name: 'gpt-image-studio',           // ⚠️ 必须与子应用的 QIANKUN_APP_NAME 一致
      entry: entryUrl,
      container: containerRef.value!,
      props: {
        companionUrl: tokenVo.companionUrl,
        jwt: tokenVo.token,
        hideSidebar: true,                 // 隐藏子应用侧边栏，由宿主接管会话管理
        allowedOrigins: [location.origin], // 跨域白名单
      },
    }, {
      sandbox: { experimentalStyleIsolation: true },  // Tailwind 类名隔离
    });

    bridge.startListening();
  } catch (e) {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  bridge.stopListening();
  microApp?.unmount();
  microApp = null;
});
</script>

<template>
  <div class="studio-workspace">
    <div v-if="loading" class="loading">正在加载 AI 创作工作台...</div>
    <div ref="containerRef" class="studio-container"></div>
  </div>
</template>
```

> **Vben Admin 注意**：如果用 antd 的 `<Spin>` 包裹容器，它会渲染出 `ant-spin-nested-loading > ant-spin-container` 两层无高度的包裹 div，**截断高度链**。需要在 `<style>` 里补高度（见 Step 5）。

### Step 5 高度链适配（关键，必读）

这是嵌入态最容易踩的坑。子应用要求挂载容器有**确定的高度**，否则内容会溢出或留空。

#### 5.1 宿主容器给确定高度

```css
/* workspace.vue <style scoped> */
.studio-workspace {
  height: var(--vben-content-height);  /* Vben：viewport - header - tabbar */
  /* 非 Vben 项目用：height: calc(100vh - 你的顶栏高度); */
  overflow: hidden;
}

.studio-container {
  height: 100%;
  min-height: 0;   /* flex 子项收缩（防溢出） */
  overflow: hidden;
}
```

#### 5.2 如果用了 Spin / Loading 包裹层

```css
/* 打通被 antd Spin 截断的 100% 高度链 */
.studio-workspace :deep(.ant-spin-nested-loading),
.studio-workspace :deep(.ant-spin-container) {
  height: 100%;
}
```

#### 5.3 为什么子应用高度链容易断

子应用的高度链是：

```
宿主容器(确定高度)
  → qiankun wrapper div (height:auto)        ← 子应用已用 CSS 补 height:100%
    → <main class="h-full">
      → <section class="flex-1 flex-col">     ← 需要 min-height:0 才能收缩
        → 消息区(class="flex-1 overflow-y-auto") ← 需要 min-height:0
```

Flex 子项默认 `min-height: auto`（不收缩），消息增多后会把整个链路撑高溢出。子应用内部的 `ChatWorkspace` 和 `MessageList` 已补 `min-h-0`（根治）。但如果你用的子应用版本较旧，可以在宿主侧**防御性**补一层：

```css
/* 防御：即便子应用旧版本没补 min-h-0，宿主也能兜住 */
.studio-container :deep(> div),
.studio-container :deep(main) {
  height: 100%;
  min-height: 0;
}
.studio-container :deep(main > section),
.studio-container :deep(main > section > .overflow-y-auto) {
  min-height: 0;
}
```

> 子应用靠 `html.__embedded__` class（mount 时挂上）触发 `style.css` 里的 `html.__embedded__ body { height:100% }` 和 `[id^="__qiankun_microapp_wrapper_for_"] { height:100% }`，把宿主容器的高度传递到子应用根节点。你无需手动处理这一环。

### Step 6 通信桥（postMessage 协议封装）

封装一个 `useConversationBridge` composable，统一管理双向通信。

```ts
// src/views/studio/composables/useConversationBridge.ts
const CHILD_MESSAGE_TYPES = new Set([
  'conversations-changed',
  'active-conversation-changed',
  'settings-closed',
]);

interface Callbacks {
  onConversationsChanged?: () => void;
  onActiveConversationChanged?: (id: string) => void;
  onSettingsClosed?: () => void;
}

export function useConversationBridge(allowedOrigins: string[], callbacks: Callbacks) {
  const originSet = new Set(allowedOrigins);
  let listener: ((e: MessageEvent) => void) | null = null;

  // ⚠️ qiankun 是 div 挂载、共享 window，必须用 window.postMessage，不是 iframe
  function sendToChild(message: Record<string, unknown>) {
    window.postMessage(message, window.location.origin);
  }

  function startListening() {
    if (listener) return;
    listener = (event: MessageEvent) => {
      // ⚠️ qiankun 同 window 下 event.origin 恒为宿主 origin
      if (!originSet.has(event.origin)) return;
      if (event.source === null) return;  // 排除跨 frame
      const data = event.data;
      if (!data || typeof data.type !== 'string' || !CHILD_MESSAGE_TYPES.has(data.type)) return;

      if (data.type === 'conversations-changed') callbacks.onConversationsChanged?.();
      else if (data.type === 'active-conversation-changed') callbacks.onActiveConversationChanged?.(data.id ?? '');
      else if (data.type === 'settings-closed') callbacks.onSettingsClosed?.();
    };
    window.addEventListener('message', listener);
  }

  function stopListening() {
    if (listener) {
      window.removeEventListener('message', listener);
      listener = null;
    }
  }

  return { sendToChild, startListening, stopListening };
}
```

> **两个极易踩的坑（原集成时遇到的真实 bug）：**
> 1. `sendToChild` 不能用 `iframe.contentWindow.postMessage`——qiankun 是 div 挂载没有 iframe，会静默 no-op。必须用 `window.postMessage`。
> 2. origin 白名单要传 `[location.origin]`（宿主自己的 origin），**不是**子应用的 entry URL。因为 qiankun 共享 window，`event.origin` 恒为宿主 origin。

### Step 7 会话列表拉取与菜单同步

宿主侧边栏的会话列表来自 Companion 的 HTTP API。你需要：

1. **拉取会话列表**：`GET {companionUrl}/storage/conversations?limit=15`，带 `Authorization: Bearer {jwt}`。
2. **首次使用自动激活**：新用户首次调用 storage 接口会返回 503，需先 `POST {companionUrl}/storage/datasets/activate`。
3. **注入菜单**：把会话列表构造成菜单项，动态注入到你的侧边栏。

```ts
// src/views/studio/studioMenu.ts（精简版）
import { useAccessStore } from '@vben/stores';  // Vben；其他框架用你自己的菜单 store

const TOKEN_CACHE_TTL = 100 * 60 * 1000;  // 100 分钟（JWT 有效期 2h）
let tokenCache: { token: string; companionUrl: string; ts: number } | null = null;

export async function getCompanionToken() {
  if (tokenCache && Date.now() - tokenCache.ts < TOKEN_CACHE_TTL) return tokenCache;
  const res = await fetch('/api/v1/companion/token', { credentials: 'include' });
  const data = await res.json();  // { token, companionUrl }
  tokenCache = { ...data, ts: Date.now() };
  return tokenCache;
}

export async function fetchRecentConversations(limit = 15) {
  const { companionUrl, token } = await getCompanionToken();
  let res = await fetch(`${companionUrl}/storage/conversations?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 503) {
    // 新用户：先激活数据集
    await fetch(`${companionUrl}/storage/datasets/activate`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    res = await fetch(`${companionUrl}/storage/conversations?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  const { data: conversations } = await res.json();
  return conversations.filter((c: any) => !c.archivedAt);  // 归档的进归档页
}

// Vben：注入会话为动态菜单项
export async function syncStudioMenus() {
  const conversations = await fetchRecentConversations();
  const accessStore = useAccessStore();

  const studioChildren = [
    { path: '/studio/workspace', name: '新建会话', icon: 'lucide:plus', order: 1 },
    { path: '/studio/workspace/settings', name: '设置', icon: 'lucide:settings', order: 2 },
    ...conversations.map((c, i) => ({
      path: `/studio/workspace/${c.id}`,
      name: c.title || '未命名会话',
      icon: 'lucide:message-square',
      order: 10 + i,
    })),
    // 保留静态的「会话归档」项
  ];

  const menus = accessStore.accessMenus;
  const studio = menus.find((m) => m.path === '/studio');
  if (studio) {
    studio.children = studioChildren;
    accessStore.setAccessMenus([...menus]);
  }
}
```

> **Vben 特有**：Vben 的菜单是 `accessStore.accessMenus` 的响应式快照。`router.addRoute` **不会**更新菜单，必须调 `setAccessMenus()`。详见 [Vben 文档](https://doc.vben.pro/)。

### Step 8 路由守卫（keepAlive + 页签合并）

#### keepAlive

路由 meta 里 `keepAlive: true`（Step 3 已配），防止切 tab 时卸载 qiankun 子应用。

#### 页签合并（Vben 特有，但原理通用）

如果不处理，切换会话时每开一个会话会多一个页签。需要给所有 `/studio/workspace/*` 路由统一注入一个 query 参数（如 `pageKey`），让页签系统把它们合并为一个页签：

```ts
// src/router/guard.ts（全局 beforeEach）
router.beforeEach((to) => {
  // 所有工作台路由统一补 pageKey，合并为同一页签 + 同一 <component :key>
  if (to.path.startsWith('/studio/workspace')) {
    if (!to.query.pageKey) {
      return { ...to, query: { ...to.query, pageKey: 'studio-workspace' } };
    }
  }
  return true;
});

// 首次导航后触发菜单同步
router.afterEach(() => {
  void syncStudioMenus();
});
```

> ⚠️ **必须用全局守卫，不能用路由 `beforeEnter`**：同一条路由记录内 param 变化（`/workspace/c-a → /workspace/c-b`）不会重新触发 `beforeEnter`，会漏补 query 导致页签分裂。

---

## 五、子应用已内置的机制（无需你改，但需理解）

gpt-image-studio 已经为嵌入做好了准备。以下机制都是**现成的**，你只需要知道它们的存在和约束。

### 5.1 qiankun 生命周期

子应用 `src/main.ts` 导出了标准的 `bootstrap / mount / unmount` 生命周期，并通过 `window['gpt-image-studio']` 全局挂载供 qiankun 的 import-entry 在生产构建产物中发现（Vite IIFE 产物会剥离顶层 export）。

- **检测方式**：`window.__POWERED_BY_QIANKUN__`（qiankun 注入）
- **独立态**：检测到非 qiankun 时直接 `render({})` 挂到 `#app`
- **嵌入态**：导出 lifecycle，`mount(props)` 时读 props 注入配置

### 5.2 QiankunProps 契约

宿主通过 qiankun props 传入以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `companionUrl` | `string` | ✅ | Companion 服务地址 |
| `jwt` | `string` | ✅ | 宿主签发的 Companion JWT |
| `hideSidebar` | `boolean` | — | 是否隐藏子应用侧边栏（默认 `true`） |
| `allowedOrigins` | `string[]` | 跨域时必填 | 宿主 origin 白名单，供 postMessage origin 校验 |
| `container` | `HTMLElement` | 自动 | qiankun 自动传入挂载容器 |

### 5.3 嵌入态自动行为（`applyEmbeddedConfig`）

子应用 `mount` 时会调用 `settings.applyEmbeddedConfig()`，自动：

- 强制 `connectionMode = 'localCompanion'`（走 Companion 代理，禁用直连）
- 设置 `isEmbedded = true`
- **禁用**连接模式切换、Companion 管理页链接、凭据迁移（嵌入态配置由宿主管控）
- **禁用**嵌入配置写入 localStorage（防止覆盖独立态配置）

### 5.4 嵌入态不碰 URL

嵌入态下，子应用所有 URL 读写操作（select 主动 push、watch 兜底 replace、popstate 恢复）都被 `__POWERED_BY_QIANKUN__` 闸门拦截。因为 qiankun 下子应用写 URL 会被 single-spa 捕获合成 popstate，干扰宿主路由。激活同步完全走 `active-conversation-changed` postMessage 通知。

### 5.5 CSS 注入

qiankun 会把 entry HTML 的 `<link>` 内联成 `<style>` 塞进挂载容器，但 Vue `app.mount` 会清空容器 innerHTML 把它销毁。子应用在 `mount` 时通过 `injectEmbeddedCss()` 手动把 bundle CSS 以 `<link>` 注入宿主真实 `document.head`（通过 `container.ownerDocument` 绕过沙箱），解决样式丢失问题。

### 5.6 嵌入态高度链

子应用 `style.css` 中：

```css
html.__embedded__,
html.__embedded__ body { height: 100%; }

html.__embedded__ [id^="__qiankun_microapp_wrapper_for_"] {
  height: 100%;
}
```

把宿主容器的确定高度传递到子应用根节点。`__embedded__` class 在 mount 时挂上、unmount 时移除。

### 5.7 嵌入态 header 删/改按钮

当 `hideSidebar=true` 且有激活会话时，子应用 ChatWorkspace 的 header 会显示重命名 / 删除按钮（独立态走侧边栏行内按钮）。这样即使宿主不提供工具条，用户也能删 / 改会话。

### 5.8 嵌入态设置弹窗层级

子应用设置弹窗在嵌入态自动提升 z-index 到 `300`（高于 Vben header 的 201），确保蒙层遮满整个宿主页面、模态框不被 header / tabbar 遮挡。弹窗内容仍是居中卡片样式。

---

## 六、通信协议速查

### 宿主 → 子应用

```ts
{ type: "select-conversation", id }   // 选中会话
{ type: "create-conversation" }       // 新建会话
{ type: "delete-conversation", id }   // 删除（子应用自带确认弹框）
{ type: "rename-conversation", id }   // 重命名（子应用打开改名弹窗）
{ type: "open-settings" }             // 打开设置弹窗
```

### 子应用 → 宿主

```ts
{ type: "conversations-changed" }              // 会话列表变了，宿主重新拉取并刷新菜单
{ type: "active-conversation-changed", id }    // 激活会话变了，宿主更新 URL 和菜单高亮
{ type: "settings-closed" }                    // 设置弹窗已关闭，宿主把 URL 从 /settings 清回会话态
```

> **`settings-closed` 很重要**：如果不处理，URL 会停在 `/studio/workspace/settings`，再点「设置」菜单（URL 相同）不会触发路由 watch，设置弹窗无法重新打开。

---

## 七、常见坑与解法（实战总结）

以下是真实集成中遇到的全部问题，逐一记录。

### 坑 1：postMessage 通信完全不生效

**症状**：宿主发指令子应用无反应，子应用发通知宿主收不到。

**根因**：qiankun 是 **div 挂载**（共享 `window`），不是 iframe。如果通信代码用了 `iframe.contentWindow.postMessage`，`iframe` 恒为 null，所有指令静默 no-op。

**解法**：`sendToChild` 用 `window.postMessage(msg, location.origin)`；监听用 `window.addEventListener('message', ...)`。

### 坑 2：origin 白名单传错导致消息被丢弃

**症状**：通信代码改成 `window.postMessage` 后仍不生效。

**根因**：qiankun 同 window 下 `event.origin` 恒为**宿主 origin**，不是子应用 entry URL。如果白名单传的是子应用地址（如 `https://studio.example.com`），而 `event.origin` 是 `https://admin.example.com`，消息全被丢弃。

**解法**：白名单传 `[location.origin]`。

### 坑 3：空态下方留空、有内容时溢出

**症状**：空会话时工作台下方有一截空白（高度不够）；消息多了整页溢出出现滚动条、输入框被顶出可视区。

**根因**：高度链断裂。① Loading 包裹层（如 antd Spin）渲染的 div 无高度，截断 `100%` 链；② flex 子项默认 `min-height: auto` 不收缩，内容撑破容器。

**解法**：见 [Step 5](#step-5-高度链适配关键必读)。宿主容器给确定高度 + 打通包裹层 + flex 链补 `min-height: 0`。

### 坑 4：切 tab 后子应用被卸载

**症状**：切到别的页签再切回来，子应用重新加载、状态丢失。

**根因**：路由 meta 没配 `keepAlive: true`。

**解法**：路由 meta 加 `keepAlive: true`。

### 坑 5：每切一个会话开一个页签

**症状**：点击侧边栏不同会话，页签栏堆积大量页签。

**根因**：页签系统按完整路径（含会话 id）区分页签，每个会话一个页签。

**解法**：给所有工作台路由统一注入 query 参数（如 `pageKey=studio-workspace`），页签系统按 query 合并。必须用全局守卫，不能用路由 `beforeEnter`（param 变化不触发）。

### 坑 6：删除会话后宿主菜单不刷新

**症状**：在子应用 header 点删除并确认后，子应用内会话已删，但宿主侧边栏菜单的被删项残留（选中态却跳到了下一会话）。

**根因**：子应用的删除操作如果只删数据、不发 `conversations-changed` 通知，宿主就不知道列表变了。当前版本已修复（header 删除按钮会发通知），但如果你调用的是子应用其他删除路径需注意。

**解法**：确保删除 / 重命名 / 新建后子应用都发 `conversations-changed` 通知；宿主收到后重新拉取并刷新菜单。

### 坑 7：设置弹窗关闭后无法重开

**症状**：点设置打开弹窗 → 关闭 → 再点设置菜单，弹窗不出现。

**根因**：关闭弹窗后 URL 停在 `/studio/workspace/settings`，再点设置菜单 URL 不变，路由 watch 不触发。

**解法**：子应用关闭弹窗时发 `settings-closed` 通知；宿主收到后把 URL 从 `/settings` 清回会话态。这样再点设置时 URL 变化 → watch 触发 → 正常打开。

### 坑 8：设置弹窗被宿主 header 遮挡

**症状**：设置弹窗的蒙层看起来只覆盖子应用区域，被宿主的 header / tabbar 压住。

**根因**：子应用弹窗 z-index（如 `50`）低于宿主 header（Vben 默认 201）。

**解法**：子应用嵌入态自动提升弹窗 z-index 到 `300`（当前版本已内置）。如果你用的是旧版本子应用，可在宿主侧全局 CSS 补一层：

```css
/* 宿主全局样式 */
[id^="__qiankun_microapp_wrapper_for_"] .your-modal-class {
  z-index: 300 !important;
}
```

### 坑 9：双确认弹框

**症状**：点删除按钮弹出两个确认框。

**根因**：宿主删除按钮先弹自己的确认框，确认后再通知子应用删除，而子应用删除流程**本就内置**确认弹框 → 串联。

**解法**：删除 / 重命名入口交给子应用处理（子应用 header 的按钮），宿主不要再叠加一层确认。或者宿主侧删除直接发 `delete-conversation` 指令，不加自己的确认弹框。

### 坑 10：初始选中会话不生效

**症状**：带会话 id 进入页面（如从书签进 `/studio/workspace/c-xxx`），子应用没切到该会话。

**根因**：子应用的 `select` 自带存在性校验，数据未加载完时 no-op。

**解法**：以子应用的首条 `active-conversation-changed` 作为就绪信号，之后带重试补发 `select-conversation`（如 5 次 × 600ms），直到子应用报告该 id 为激活。

---

## 八、快速验收清单

集成完成后，逐项验证：

- [ ] **加载**：进工作台页，子应用创作界面正常显示
- [ ] **高度**：空会话无底部留空；消息增多不溢出、无 document 滚动条
- [ ] **新建**：点新建 → 子应用创建新会话 → 宿主菜单出现新项
- [ ] **选中**：点菜单会话 → 子应用切换 → URL 同步 → 菜单高亮正确
- [ ] **删除**：点 header 删除 → 只弹一个确认框 → 确认后会话删除 → 宿主菜单刷新
- [ ] **重命名**：点 header 重命名 → 弹改名框 → 改名后菜单标题同步
- [ ] **设置**：点设置 → 弹窗打开、蒙层遮满全屏、内容居中卡片
- [ ] **设置重开**：关闭设置 → 再点设置 → 弹窗能重新打开
- [ ] **切 tab**：切走再切回 → 子应用状态保留、不重新加载
- [ ] **页签**：切换不同会话 → 只有一个页签，不堆积
- [ ] **文生图**：输入 prompt → 图片正常生成（Companion 链路通）
- [ ] **隔离**：不同用户登录看到各自的会话

---

## 附：demo 宿主参考

子应用仓库的 `examples/qiankun-host/index.html` 是一个完整的单文件 demo 宿主（浏览器自签 JWT + 自动激活数据集 + 注册子应用），可作为最小可运行的参考实现。

---

> **有问题？** 本指南基于真实集成提炼，如果你在集成中遇到本文未覆盖的问题，欢迎提 issue。
