# Backlog 分析：server 模式全链路分页

> 状态：✅ 全部完成——PR-a ~ PR-d 全部落地（2026-08-03），PR-e 容量估算聚合顺手完成，PR-f（备份导出分批化）+ PR-g（图片库虚拟滚动）于 2026-08-05 落地，原两项后置项清零
> 来源：2026-08-03 PR9 验收讨论中提出——server 模式部署到服务器后，全量加载模型不成立
> 关联：PR9（视口懒加载，与本方案互补）、阶段二（Companion 后端化）、决策 T2（StudioStorage 纯 CRUD）

## 1. 问题陈述

server 模式（多用户 SaaS，Companion 部署在服务器）下，数据量随使用时间无界增长。当前**从 HTTP 到 UI 的整条链路没有任何一处有分页**：

| 层 | 现状 | 位置 |
|---|---|---|
| Companion HTTP | `GET /storage/:table` 全量返回 `{ data: T[] }`，无任何分页/过滤参数 | `companion/src/routes/storage.ts:168-183` |
| Companion SQLite | 业务表是纯 KV（`key` + `value` JSON），**无二级索引、无 ORDER BY**，`SELECT value FROM :table` 全量 | `companion/src/storage/schema.ts:92-100`、`businessDb.ts:74-79` |
| 前端存储抽象 | `StudioStorage.list(store): Promise<T[]>` 无参全量；契约注释写死"不支持 query by index" | `src/services/storage/types.ts:57-64` |
| 启动恢复 | `Promise.all` 一次性拉 settings + conversations + **messages 全量** + imageAssets 四张表 | `src/features/backup/useStudioRestore.ts:63-69` |
| 内存 store | `activeMessages` = 全量 messages 数组按 conversationId 内存 filter | `src/stores/conversationsStore.ts:40-44` |
| UI | 会话列表 / 消息列表 / 图片库全部 `v-for` 全渲染，无虚拟滚动 | `ConversationSidebar.vue:157`、`MessageList.vue:58-75`、`ImageGrid.vue:36-45` |

本地 IndexedDB 场景全量还能扛（磁盘本地、毫秒级）；server 场景下 messages 表动辄几千上万条，启动一次全量拉取既慢又费流量，且随时间线性劣化。

## 2. 核心矛盾：两个写死的设计决策要被推翻

1. **T2（纯 CRUD，不支持 query by index）**——`types.ts:5-6` 的设计决策，当时是 IndexedDB 镜像思维。分页本质上就是"按索引查子集"，必须在接口层引入查询概念。这不是绕过能解决的，要正式修订 T2。
2. **KV schema（无关系列）**——`schema.ts:6-9` 注释明确"刻意避免关系列"。所有排序键（`updatedAt`/`createdAt`）和外键（`conversationId`）都封在 `value` JSON 里。服务端分页要么 `json_extract`，要么加真实列。

## 3. 方案分析

### 3.1 SQL 层：怎么查子集

两条路：

- **A. `json_extract`（轻量起步）**：`SELECT value FROM messages WHERE json_extract(value,'$.conversationId') = ? ORDER BY json_extract(value,'$.createdAt') LIMIT ?`。零 schema 变更，可加表达式索引（`CREATE INDEX ... ON messages(json_extract(value,'$.createdAt'))`）兜底性能。适合数据量万级以内。
- **B. 真实列 + 迁移（正道）**：业务表加 `created_at`、`conversation_id` 等列，`putRecord` 时从 JSON 同步写入；`BUSINESS_DB_VERSION` 升 2，`PRAGMA user_version` 迁移框架已有。索引是正经 B-tree，万级以上不心虚。代价是 schema 迁移 + 双写一致性。

**建议：A 起步，B 作为同 PR 或紧随其后的一步**——迁移框架现成，列同步在 `putRecord`（`businessDb.ts:96`）一处收口，成本没有想象中高。若坚持最小改动，A + 表达式索引也够用到很大数据量。

> **PR-a 落地时拍板：直接做 B**（2026-08-03）。理由：Companion 未上线、无生产数据，迁移成本历史最低；A 只是"够用"，B 才是 server 化正道。

### 3.2 HTTP 层：契约怎么改

`GET /storage/:table` 增加可选 query 参数，**不传时保持现状全量返回**（向后兼容——宿主 demo `examples/qiankun-host/index.html:148-164` 和旧前端直连这个接口）：

```
GET /storage/messages?conversationId=<id>&before=<createdAt 游标>&limit=50
GET /storage/conversations?before=<updatedAt 游标>&limit=50
GET /storage/imageAssets?conversationId=<id>&before=<createdAt>&limit=100
```

- **游标（before=时间戳+key tiebreak）优于 offset**：数据在持续写入（新消息、新图），offset 会漂移漏数据；游标稳定。三张表都有单调时间字段可做游标。
- 响应形状：分页时 `{ data: T[], nextCursor: string | null, total?: number }`；`total` 供"共 N 张图片"计数（`ImageLibrary.vue:160` 依赖），可用 `COUNT(*)` 或省略显式 count 接口。
- 注意现有契约"返回顺序不保证、调用方自己排"（service 层排序：`conversations.ts:19-26`、`messages.ts:19-24`、`imageAssets.ts:18-25`）——分页后服务端必须 `ORDER BY`，契约文档要改。

### 3.3 StudioStorage 接口：怎么扩展

不动现有 `list(store)` 全量签名（备份导出、容量估算仍需要全量，见 3.6），新增可选方法：

```ts
listPage?<T>(store: StoreName, opts: {
  conversationId?: string;
  before?: string;        // 游标
  limit: number;
}): Promise<{ data: T[]; nextCursor: string | null }>;
```

- 设为**可选方法**：IndexedDbStorage 用 IDB index + cursor 原生实现（`conversationId`/`createdAt` 索引本来就在）；CompanionStorage 走 HTTP query。运行时探测，不支持时回退全量 list + 内存分页——local 模式数据量小，回退无感。
- 决策 T2 文档（`evolution-roadmap.md` 或决策章节）需正式修订并记录理由。

### 3.4 启动恢复：按需加载（收益最大的一刀）

`useStudioRestore.ts:63-69` 改为：

1. conversations 只拉第一页（如 50 条，按 updatedAt 降序）——侧边栏首屏；
2. **messages 不再全量拉**：只拉激活会话的最新一页（如 50 条，按 createdAt 倒序取尾部）；
3. imageAssets 只拉第一页（配合 PR9 blob 懒加载，首屏请求量可降到几十 KB 级 JSON + 视口内 blob）；
4. 其余惰性触发：切会话 → 拉该会话消息页；侧边栏滚到底 → 拉下一页 conversations；图片库滚动 → 拉下一页 assets。

启动从"四张表全量"变成"三次分页请求"，数据量再大涨启动耗时也基本恒定。

### 3.5 UI 层：三个列表的渲染策略

| 列表 | 策略 |
|---|---|
| 会话侧边栏 | 分页追加（滚动到底拉下一页）即可，条数通常有限，不必虚拟滚动 |
| 聊天消息 | 向上滚动加载更早消息（chat 标准交互，游标=当前最早一条的 createdAt）；长会话再考虑 vue-virtual-scroller，可后置 |
| 图片库 | PR9 的 IntersectionObserver 懒加载**保留**（管 blob 何时拉）；本方案加"滚动接近底部拉下一页 metadata"。真到几千张再评估虚拟列表 |

与 PR9 的关系：**互补不冲突**——分页管"哪些条目进 DOM"，PR9 懒加载管"进了 DOM 的条目何时拉 blob"，届时懒加载原样套用在每页条目上。

### 3.6 全量消费点的兼容方案

分页化后仍有三个全量需求，不能误伤：

- **备份导出**（`src/services/backups.ts:80-87`）：改成分页迭代拉完全部（服务端导出让客户端翻页），或加专用 `/storage/export` 流式接口（更优，但可后置）。
- **容量估算**（`src/services/storageUsage.ts:34-39`）：走服务端 `SUM(LENGTH(value))` 聚合接口，根本不该拉数据。
- **宿主 demo 会话列表**（`index.html:148`）：直连 HTTP 的第二消费方，参数不传即全量，天然兼容；demo 可顺手演示分页参数。

### 3.7 多租户

无额外障碍：隔离在 db 文件层（`datasetRegistry.ts:181-184`，每用户独立目录/db），分页 SQL 不需要 userId 条件；连接缓存按 dbPath 天然分用户。

## 4. 建议拆分（立项时）

1. **PR-a：Companion 查询能力**——✅ 已完成（2026-08-03）。schema 决策拍板 **方案 B 真实列**（业务 db schema v2：三张可分页表加 `updated_at`/`created_at`/`conversation_id` 派生列 + B-tree 复合索引，v1 旧库打开时自动迁移回填；`value` JSON 仍是数据真相源）。拍板理由：Companion 未上线、无生产数据，此时迁移成本历史最低；方案 A（json_extract）只是"够用"，方案 B 才是 server 化的正道。`/storage/:table` 加分页参数（`conversationId`/`before`/`limit`，不传保持全量旧契约），响应 `{ data, nextCursor, total }`；契约已补录进 `phase2-pr4-storage-routes.md`「分页契约」节。纯后端，前端不动。
2. **PR-b：StudioStorage 接口扩展**——✅ 已完成（2026-08-03）。`listPage` 可选方法落进 `types.ts`（含 `ListPageOptions/ListPageResult`、游标编解码 helpers、T2 修订注释），三实现齐备：IndexedDbStorage（排序索引 `openCursor 'prev'` 遍历跳过）、CompanionStorage（透传 HTTP query）、InMemoryStorage（内存分页，逻辑收编 `inMemoryPage.ts` 与 service 层回退路径 `listPageWithFallback` 共享）。契约测试六例三实现共跑。**local 模式拍板：同步启用分页**，单一代码路径，无"local 永远全量"分叉。
3. **PR-c：启动恢复按需加载**——✅ 已完成（2026-08-03）。restore 不再接收三个数据 ref，改驱动 store 分页动作：会话第一页（50）→ URL `?c=` 定位（第一页找不到 `getById` 兜底）→ 图片全局第一页（100）→ 并发拉当前会话消息窗口（50）+ 当前会话图片全量。messages ref 语义改为"当前会话已加载窗口"（DESC 拉取、正序展示、prepend 翻页、token 竞态守卫、pending→error 归一化收编进 `services/messages.ts`）；级联删除改查存储跨页走透，不再依赖内存 filter。切会话由 ViewModel 的 `activeConversationId` watch 单点驱动加载，store 幂等去重。
4. **PR-d：列表 UI 滚动加载**——✅ 已完成（2026-08-03）。侧边栏滚到底 `loadMoreConversations`；消息列表向上滚动 `loadEarlierMessages`（prepend 时按 scrollHeight 差值保持视口锚定）；图片库"全部图片"滚到底 `loadMoreAssets`，头部计数"全部"tab 改用服务端 `assetsTotal`（"当前会话"已全量，length 即真实数）。项目无组件挂载测试设施（无 @vue/test-utils），UI 层为薄接线，行为集中在已测的 store 动作。
5. **PR-e（可后置）**——部分完成：**容量估算聚合 ✅**（`storageUsage.ts` 改委托 `storage.estimateStoredBytes()`，Companion 走 `/storage/usage` 服务端 SQL 聚合，消灭分页化后最后一个自动触发的整库拉取）。**同日修掉一个存量 bug**：`imagesStore.refreshStorageUsage` 原来用 `storageUsage.ts` 的模块级默认实例（无参 `resolveStorage()` 恒为 IndexedDbStorage），导致 Companion 模式下容量面板读的是浏览器 IndexedDB 的数字（表现为"库里没几张图却显示几百 MB"）。修复：storageUsage service 按 T1 决策注入（ViewModel 唯一装配点创建、经 `useStudioImages` 透传进 context），模块级默认实例随唯一调用方消失而删除。
6. **PR-f：备份导出分批化 ✅**（2026-08-05 落地）。原"后置"项，提前清零。**问题**：`backups.ts create()` 原一次性 `Promise.all` 全量拉 4 表（含 imageBlobs 全部二进制）进内存，server 模式下数据量大时单次内存峰值高。**方案**（Web 侧分批迭代，不动 Companion HTTP 契约，零新依赖）：新增 `iterateAll` helper（`inMemoryPage.ts`，游标翻页拉完全部，可选 `onPage` 回调逐页处理）；`create()` 三张元数据表改走 `iterateAll` 分批拉；**图片二进制改 imageAssets 驱动逐个 `loadImageBlob`**，每拿到一个立即构造 zip entry，峰值内存从"全部 blob 同时驻留"降到"一个 blob"，且与 restore 侧（imageAssets 驱动写 blob + `validateImageBlobs` 校验）天然对称。**不真正流式 ZIP**（格式要求中心目录在后，端到端流式复杂度过高）——收益在消除 blob 全量内存堆积 + 单次全表 HTTP。`list()` 全量契约保留、restore 不动、zipArchive 签名不变。`iterateAll` 6 例单测覆盖（翻页/回调/空表/pageSize/conversationId/无 listPage 回退）。
7. **PR-g：图片库虚拟滚动 ✅**（2026-08-05 落地）。原"后置"项，提前清零。**范围决策**：只做 ImageGrid（图片增长最快、卡片高度近似固定 h-12+truncate≈72px、向下追加简单），会话侧边栏（条数有限）与消息列表（变高 + 向上 prepend 锚定复杂）按 backlog 原判断继续后置。**方案**（零依赖手写窗口化，符合项目手写优先风格）：新增 `useVirtualList` composable（`composables/useVirtualList.ts`），核心是纯函数 `computeWindow(scrollTop, viewport, count, itemHeight, overscan)` 算可见区间，composable 包装 DOM 监听（scroll + ResizeObserver）；ImageGrid 用 totalHeight 占位撑滚动条 + translateY 偏移可见区，`v-for` 只渲染 `visibleItems`（可见 + overscan）。**与 PR9 共存**：ImageCard 的 IntersectionObserver 懒加载不动——已加载 `previewUrl` 的卡片 remount 时 bail out（`ImageCard.vue:34`），`ensurePreviewLoaded` 幂等，虚拟化只决定哪些卡片进 DOM。滚到底 `loadMore` 翻页逻辑收编进 composable 的 onScroll。`computeWindow` 8 例单测覆盖全边界。

每步独立可验收、可回滚（参数可选 + 接口可选 + 运行时回退全量，整条链始终有 fallback）。

## 5. 开放问题（立项时拍板）

- ~~json_extract 表达式索引 vs 真实列迁移~~——**PR-a 已拍板：方案 B 真实列迁移**（业务 db schema v2）。Companion 未上线、无生产数据要兼容，迁移成本最低；方案 A（json_extract 表达式索引）被否——它只是"够用"，每次新增查询字段都要迁就 JSON 掏值，server 化方向下会持续制造妥协。
- `total` 计数要不要、怎么要——**PR-a 已拍板：要**，`COUNT(*)` 每次查（带 conversationId 过滤条件，不含 before/limit）。SQLite COUNT 是毫秒级，缓存收益不抵复杂度。
- ~~messages 分页后，内存全量 filter 的 `activeMessages` 要改成"分页窗口"~~——**PR-c 已落地**：messages ref 语义改为"当前会话已加载窗口"，`activeMessages` 仍是 filter 但输入已是窗口；逐一排查结果：级联删除改查存储跨页走透（`listByConversationId`）、草稿附件改为"保留 id + 按需补加载"（`ensureAssetsLoaded`），无其它全量依赖残留。
- ~~local 模式（IndexedDB）是否同步启用分页~~——**PR-b 已拍板：同步启用**。IndexedDbStorage 原生实现 `listPage`（排序索引 cursor 遍历），local/server 单一代码路径；运行时回退（`listPageWithFallback`）仅为"后端不支持 listPage"的假设场景兜底，当前三实现全部支持。