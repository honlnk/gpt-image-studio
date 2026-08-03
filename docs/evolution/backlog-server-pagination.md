# Backlog 分析：server 模式全链路分页

> 状态：📄 分析稿（未排期，Backlog 项，单独立项）
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

1. **PR-a：Companion 查询能力**——schema 决策（json_extract 或加列）+ `/storage/:table` 分页/过滤参数 + 契约测试。纯后端，前端不动。
2. **PR-b：StudioStorage 接口扩展**——`listPage` 可选方法 + 双实现 + T2 决策修订。
3. **PR-c：启动恢复按需加载**——restore 改造 + 切会话惰性拉消息（用户体验收益核心）。
4. **PR-d：列表 UI 滚动加载**——侧边栏/消息/图片库三个列表 + 计数兼容。
5. **PR-e（可后置）**：备份导出走分页迭代或专用接口、容量估算聚合接口、虚拟列表评估。

每步独立可验收、可回滚（参数可选 + 接口可选 + 运行时回退全量，整条链始终有 fallback）。

## 5. 开放问题（立项时拍板）

- json_extract 表达式索引 vs 真实列迁移——建议立项 PR-a 时用演示数据集实测一把再定。
- `total` 计数要不要、怎么要（COUNT(*) 每次查 vs 缓存 vs 不要）。
- messages 分页后，内存全量 filter 的 `activeMessages`（`conversationsStore.ts:40-44`）要改成"分页窗口 + 已加载缓存"，跨会话未读角标之类依赖全量 messages 的逻辑需逐一排查。
- local 模式（IndexedDB）是否同步启用分页加载，还是永远全量回退——建议同步启用，保持单一代码路径。
