# 阶段一：前端存储抽象层（地基）

> **状态**：✅ 已完成（2026-07-27，6 个 PR 全部合入）
> **前置**：阶段零 ✅ 已完成（Companion 自带管理页，Web 项目 `/companion` 页面已移除）
> **纲领**：[`evolution-roadmap.md` 第六章](../evolution-roadmap.md#六阶段一前端存储抽象层地基)
> **核心原则**：运行时行为零变化，存储后端变得可替换。

## 目标

在前端引入一层 `StudioStorage` 接口，把所有"直接调 IndexedDB / localStorage"的代码收敛到接口背后。**运行时行为与当前完全一致**，但存储后端变得可替换，为阶段二/三/四铺路。

## 代码现状基线（2026-07-27 探查结论）

> 本节是阶段一启动前的代码事实快照，所有 PR 计划以此为准。探查报告全文见各 PR 文档附录。

### service 层直调 db.ts 的清单

| service | db.ts 导入 | 操作的 store | 备注 |
|---|---|---|---|
| `conversations.ts` | delete/getAll/put | conversations | 单 store |
| `messages.ts` | delete/getAll/put | messages | 单 store |
| `imageAssets.ts` | delete/getAll/get/put | imageAssets + imageBlobs | **唯一跨两 store 的 domain service** |
| `settings.ts` | get/put | settings | 单 store |
| `conversationDrafts.ts` | delete/getAll/get/put | conversationDrafts | 单 store |
| `analyticsEvents.ts` | clear/getAll/put | analyticsEvents | **唯一用 clearStore 的 domain service** |
| `backups.ts` | clear/getAll/put | conversations/messages/imageAssets/imageBlobs/settings | 跨 5 store，**不走 domain service** |
| `storageUsage.ts` | getAll | 6 store 全读 | 只读 |
| `timeFieldMigration.ts` | getAll/put | conversations/messages/imageAssets | 跨 3 store |

### ImageBlobRecord 重复定义（3 处）

| 文件 | 行号 |
|---|---|
| `src/services/imageAssets.ts` | L5-8 |
| `src/services/backups.ts` | L20-23 |
| `src/services/storageUsage.ts` | L4-7 |

三处内容完全相同（`{ key: string; blob: Blob }`），均未导出。PR6 统一收敛。

### store 层装配机制

| store | 导出 | configure 机制 | context 字段数 |
|---|---|---|---|
| `generationStore.ts` | `useGenerationStore` | `configureGenerationStore(ctx)` | 21 |
| `conversationsStore.ts` | `useConversationsStore` | `configureConversationsStore(ctx)` | 3 |
| `imagesStore.ts` | `useImagesStore` | `configureImagesStore(ctx)` | 3 |
| **`settingsStore.ts`** | `useSettingsStore` | **❌ 无** | 硬编码 import |
| `analyticsStore.ts` | `useAnalyticsStore` | `configure(settings)`（签名特殊） | 2 |

**关键**：settingsStore 是 5 个 store 里唯一没有 configure 机制的，PR2 必须新增 `configureSettingsStore(context)`。

### ViewModel 装配点（`src/app/studio/useStudioViewModel.ts`，733 行）

- imageClient 装配：L144-204
- imageClient 注入 generationStore：L219
- hydrate 流程：L243-256（`useStudioRestore`）
- onMounted 触发：L323-345
- Store 创建顺序：settings → composer → feedback → analytics → companion → conversations → images → drafts → imageClient → generation → restore → backup

### settingsStore 的 localStorage 使用

`SETTINGS_STORAGE_KEYS`（settingsStore.ts L66-71）定义 4 个 key：

| key | 当前行为 | 阶段一处理（PR5） |
|---|---|---|
| `gpt-image-studio:companion-url` | companionUrl **唯一存储**（读 L146 / 写 watch L601-603），不进 IndexedDB | 收编 → `writeConfig` |
| `gpt-image-studio:companion-access-key` | companionAccessKey **唯一存储**（读 L149 / 写 watch L604-606），不进 IndexedDB | 收编 → `writeConfig` |
| `gpt-image-studio:api-key` | 启动读初始值（L123），运行时持久化走 IndexedDB settings 表 | 废弃 localStorage 入口（一次性迁移） |
| `gpt-image-studio:api-base-url` | 同 api-key（L124 读，不写 localStorage） | 同上 |

**注意**：settingsStore 内无直接 `localStorage.` 调用，全部走 `shared/localStorage.ts` 的 `readStorage/writeStorage` 封装。`src/stores/` 全局 grep `localStorage.` 为 0 命中。

## PR 拆分与依赖

```
PR1 (接口+实现+测试骨架)
  │  纯新增，db.ts 并存，零行为变化
  ▼
PR2 (6 domain service 改工厂 + store context 注入)
  │  settingsStore 新增 configure
  ▼
PR3 (backups/storageUsage/timeFieldMigration 改走 storage)
  │  3 个孤立模块
  ▼
PR4 (feature 层 import 改造 + ViewModel 装配点接入)
  │  hydrate 是关键路径
  ▼
PR5 (companion 凭据收编 + localStorage 迁移 + 备份更新)
  │  涉及敏感凭据
  ▼
PR6 (ImageBlobRecord 收敛 + 删除旧 db.ts + 文档收尾)
```

每个 PR 独立可合并、typecheck/test 全绿、可独立回滚。最坏情况回滚到 PR1（抽象层在但不被使用，db.ts 仍是唯一入口，业务零影响）。

## 全局验收门槛（阶段一整体完成时）

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿
- ✅ **契约测试套件**对 IndexedDbStorage 实现全绿（30+ 用例）
- ✅ **schema 迁移有测试覆盖**（fake-indexeddb，`IndexedDbStorage.test.ts`）
- ✅ grep 确认 store/feature 层**无残留模块级静态 import** service：
  ```bash
  grep -rnE "from \"\.\./(\.\./)?services/(conversations|messages|imageAssets|settings|conversationDrafts|analyticsEvents|backups|storageUsage|timeFieldMigration)\"" src/stores/ src/features/ src/app/ | grep -v "create.*Services"
  ```
  应返回空
- ✅ grep 确认**无残留 `localStorage.` 直连**（除 `shared/localStorage.ts` 和遗留 draft 键）
- ✅ companion 凭据在 IndexedDB settings 表中可见（DevTools 验证）
- ✅ DevTools → IndexedDB 内容与改造前一致（除新增 companion 凭据字段）
- ✅ **运行时行为零变化**：生成、编辑、导入、备份恢复、草稿、Companion 连接、分析导出全部正常

## 不做的事（本阶段边界）

- ❌ 不改 Companion 后端代码
- ❌ 不实现 CompanionStorage / NativeStorage 的真实逻辑（只留骨架）
- ❌ 不改 Tauri 壳
- ❌ 不改 UI、不改路由、不改 connectionMode 语义
- ❌ 不引入运行时数据迁移（companion 凭据迁移除外，那是收编不是数据迁移）

## 风险矩阵（阶段一全局）

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 工厂注入改造面大（5 store + 6 feature 层） | 高 | PR1 先建抽象层并存，PR2-6 逐步迁移，每个 PR 独立可回滚 |
| 契约测试套件设计不当，漏边界 | 中 | 参考 `companionKnownFields.contract.test.ts`；PR1 先建骨架 |
| hydrate 流程是关键路径 | 中 | PR4 单独聚焦 hydrate，先保留旧路径并存，新路径验证后再切换 |
| companion 凭据迁移丢数据 | 中 | 一次性迁移加 dry-run；迁移后 localStorage 不立即清，保留一个版本周期兜底 |
| fake-indexeddb 与真实 IndexedDB 行为差异 | 中 | 契约测试只断言语义；关键路径 manual smoke test |

## 实施记录

（每个 PR 合并后在此追加）
