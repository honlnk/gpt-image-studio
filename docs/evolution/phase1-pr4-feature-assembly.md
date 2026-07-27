# 阶段一 PR4：feature 层 import 改造 + ViewModel 装配点接入

> **状态**：✅ 已完成
> **依赖**：PR3 ✅
> **风险**：中（hydrate 流程是关键路径）
> **纲领**：[`evolution-roadmap.md` §6.3 运行时装配与工厂](../evolution-roadmap.md)

## 目标

ViewModel 成为唯一的 service 工厂装配点（§6.3）。所有 feature 层（restore/backup/drafts/tracker）通过注入接收 service，不再模块级 import service 函数。

## 改造清单

### ViewModel 装配点（`src/app/studio/useStudioViewModel.ts`）

在 `useStudioViewModel()` 函数体最前面创建 service 工厂全集：

```ts
const storage = resolveStorage();
const services = {
  conversations: createConversationServices(storage),
  messages: createMessageServices(storage),
  imageAssets: createImageAssetServices(storage),
  settings: createSettingsServices(storage),
  drafts: createConversationDraftServices(storage),
  analyticsEvents: createAnalyticsEventServices(storage),
  backup: createBackupServices(storage),
  timeFieldMigration: createTimeFieldMigrationServices(storage),
};
initTrackerStorage(services.analyticsEvents);  // tracker 单例注入
```

向下注入到各 feature/store：
- `useStudioSettings` ← `services.settings`
- `useStudioConversations` ← `services.conversations/messages`
- `useStudioImages` ← `services.imageAssets`
- `useStudioDrafts` ← `services.drafts`
- `useStudioGeneration` ← `services.imageAssets/messages`
- `useStudioRestore` ← service 全集（conversations/messages/imageAssets/settings/timeFieldMigration）
- `useStudioBackup` ← `services.backup`
- `applyUrlSettings` ← `services.settings.save`（替代模块级 saveSettings）

### feature 层改造（移除模块级 service import，改注入）

| feature | 改造 |
|---|---|
| `useStudioRestore` | input 加 `services: StudioRestoreServices`；移除 5 个 service 模块级 import；调用点改为 `services.xxx.method()` |
| `useStudioBackup` | input 加 `backupServices: BackupServices`；create/restore 改为 `input.backupServices.create/restore` |
| `useStudioDrafts` | input 加 `draftServices: ConversationDraftServices`；6 个调用点改为 `draftServices.xxx()` |
| `useStudioTracker` | 新增 `initTrackerStorage(services)` 注入函数；模块级默认实例兜底（单例模式约束） |

## 验收门槛

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（756 用例）
- ✅ feature 层（restore/backup/drafts/tracker）无残留 service 模块级运行时 import（仅剩 type-only import 和 tracker 单例默认实例）
- ✅ ViewModel 是唯一创建 service 工厂的装配点

## 实施记录

### 2026-07-27 实施完成

**ViewModel 装配点**：在函数体最前面创建 8 个 service 工厂（共享 resolveStorage 实例），通过 props 注入到 7 个 feature/store。`applyUrlSettings` 的 saveSettings 参数改为 `services.settings.save`。

**feature 层改造**：
- `useStudioRestore` — 新增 `StudioRestoreServices` 类型（conversations/messages/imageAssets/settings/timeFieldMigration 全集），input 要求 services，移除 5 个模块级 import。hydrate 流程的 migrate/load/list/save/delete 全部走注入的 service。
- `useStudioBackup` — input 加 `backupServices`，create/restore 走注入。
- `useStudioDrafts` — input 加 `draftServices`，6 个草稿 CRUD 调用走注入。
- `useAnalyticsTracker` — 新增 `initTrackerStorage(services)` 让 ViewModel 注入 analyticsEvents service；模块级默认实例兜底（resolveStorage + createAnalyticsEventServices），因 tracker 是模块级单例（track() 无参数），无法纯参数注入。

**更新的测试**：
- `useAnalyticsTracker.test.ts` — mock 从 `saveAnalyticsEventsBatch` 改为 `createAnalyticsEventServices`（返回带 saveBatch spy 的对象），断言改为 `mocks.saveBatch`。

**与计划的偏差**：
1. **useAnalyticsTracker 用 init 注入而非纯参数注入**。原计划「单例改为接收 analytics 工厂的初始化」——track() 是无参数的全局函数（v-track 指令调用），无法通过参数传 service。采用模块级变量 + initTrackerStorage 注入函数，ViewModel 装配时调用 init。模块级默认实例兜底保证单例在未 init 时也能工作。

**验收结果**：
- ✅ typecheck/test 全绿（756 用例）
- ✅ feature 层仅剩 type-only import 和 tracker 单例默认实例的 createAnalyticsEventServices
- ✅ ViewModel 是唯一 service 工厂装配点（resolveStorage + 8 个 createXxxServices 集中在函数体开头）
- ✅ hydrate 流程（restoreFromStorage）行为零变化（service 工厂方法名对齐，逻辑不变）
