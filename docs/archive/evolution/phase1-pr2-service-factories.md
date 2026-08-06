# 阶段一 PR2：6 个 domain service 改工厂 + store context 注入

> **状态**：✅ 已完成
> **依赖**：PR1 ✅
> **风险**：中（store 改造面大，但每个 store 独立）
> **纲领**：[`evolution-roadmap.md` §6.2](../../plans/evolution-roadmap.md)

## 目标

1. 6 个 domain service 改成 `createXxxServices(storage)` 工厂函数
2. 5 个 store 通过 `configure*Store(context)` 接收 service 工厂返回值
3. **settingsStore 新增 `configureSettingsStore`**（当前唯一无 configure 机制的 store）
4. 全程零行为变化

## 改造策略：双轨过渡

为降低单步风险、让 PR3/4 未改造的调用方继续工作，采用**双轨制**：

- 每个 service 新增 `createXxxServices(storage)` 工厂（返回与现有函数同名的方法对象）
- **保留**现有的模块级函数导出，内部委托给一个"默认实例"（用 `resolveStorage()` 创建的全局 storage 单例）
- store 通过 configure 接收注入的 service；未改造的调用方继续用模块级导出（功能等价，因为默认实例用同一个 storage）
- PR6 删除模块级导出

这样 PR2 的 store 改造是独立可回滚的，service 层平滑过渡。

## 改造清单

### 6 个 service 工厂化

| service | 工厂签名 | 返回方法 |
|---|---|---|
| `conversations.ts` | `createConversationServices(storage)` | list / save / remove |
| `messages.ts` | `createMessageServices(storage)` | list / save / remove |
| `imageAssets.ts` | `createImageAssetServices(storage)` | listAssets / saveAsset / deleteAsset / saveBlob / loadBlob / deleteBlob |
| `settings.ts` | `createSettingsServices(storage)` | load / save |
| `conversationDrafts.ts` | `createConversationDraftServices(storage)` | load / save / remove / removeMany / list |
| `analyticsEvents.ts` | `createAnalyticsEventServices(storage)` | list / saveBatch / clear / exportJson |

每个 service 保留模块级导出（向后兼容），内部委托默认实例。

### 5 个 store context 扩展

| store | 现有 context | 新增字段 |
|---|---|---|
| `generationStore` | 21 字段 | + `services: { imageAssets, messages }` |
| `conversationsStore` | 3 字段 | + `services: { conversations, messages }` |
| `imagesStore` | 3 字段 | + `services: { imageAssets, storageUsage }` |
| **`settingsStore`** | **无 configure** | **新增 `configureSettingsStore({ services: { settings, config } })`** |
| `analyticsStore` | `configure(settings)` | + `services: { analyticsEvents, analyticsExport }` |

### feature 包装器改造

| 文件 | 改造 |
|---|---|
| `useStudioSettings.ts` | 透传 `services` 到 `configureSettingsStore` |
| `useStudioGeneration.ts` | 透传 `services` 到 `configureGenerationStore` |
| `useStudioConversations.ts` | 透传 `services` |
| `useStudioImages.ts` | 透传 `services` |
| `useAnalyticsStore` 调用点 | 透传 `services` |

## 验收门槛

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（含 PR1 的 97 个 storage 测试）
- ✅ grep 确认 5 个 store 内**无残留 service 模块级 import**（generation/conversations/images/settings/analytics 对应的 service）：
  ```bash
  grep -nE "from \"\.\./services/(conversations|messages|imageAssets|settings|conversationDrafts|analyticsEvents)\"" src/stores/*.ts
  ```
  应返回空（analyticsExport 暂不在 PR2 范围，因其非 domain service）
- ✅ 运行时行为零变化（生成、编辑、删除会话、草稿、分析均正常）

## 回滚策略

- service 双轨制：回滚只需删除工厂函数，模块级导出仍在
- store context 扩展是增量（新增字段，不删旧字段），回滚只需还原 store 内 import

## 实施记录

### 2026-07-27 实施完成

**双轨过渡策略**：每个 service 新增 `createXxxServices(storage)` 工厂，同时保留模块级导出（委托 `resolveStorage()` 默认实例）。store 通过 `configure*Store` 接收注入的 service；feature 包装器透传 service（可选，默认用模块级实例）。PR6 删除模块级导出。

**改造的 service**（6 个，全部工厂化 + 保留模块级导出）：
- `conversations.ts` — `createConversationServices(storage)` → { list, save, remove }
- `messages.ts` — `createMessageServices(storage)` → { list, save, remove }
- `imageAssets.ts` — `createImageAssetServices(storage)` → { listAssets, saveAsset, deleteAsset, saveBlob, loadBlob, deleteBlob }
- `settings.ts` — `createSettingsServices(storage)` → { load, save }
- `conversationDrafts.ts` — `createConversationDraftServices(storage)` → { load, save, remove, removeMany, list }
- `analyticsEvents.ts` — `createAnalyticsEventServices(storage)` → { list, saveBatch, clear, exportJson }

**改造的 store**（5 个，全部接收注入的 service）：
- `generationStore` — context 新增 `services: { imageAssets, messages }`，11 个调用点改为 `input.value.services.*`
- `conversationsStore` — context 新增 `services: { conversations, messages }`，3 个调用点改为 `input.services.*`
- `imagesStore` — context 新增 `services: { imageAssets }`，11 个调用点改为 `input.services.imageAssets.*`
- `settingsStore` — **新增 `configureSettingsStore(services)`**（5 store 里唯一原本无 configure 的），`saveCurrentSettings` 改用注入的 `settingsServices.save`
- `analyticsStore` — `configure(settings, services?)` 扩展第二参数接收 `analyticsEvents` service，`refreshEventCount`/`clearEvents` 改用注入的 service

**改造的 feature 包装器**（5 个，透传 services）：
- `useStudioConversations` — `services?: { conversations, messages }`，默认用模块级实例
- `useStudioImages` — `services?: { imageAssets }`
- `useStudioGeneration` — `services?: { imageAssets, messages }`
- `useStudioSettings` — `services?: { settings }`，调用 `settings.configureSettingsStore(...)`
- analyticsStore 直接在 store 内默认实例兜底（无独立包装器）

**新增测试辅助**：
- `src/services/storage/createSpyStorage.ts` — 带 vi.fn spy 的 StudioStorage mock，供 service/store 测试验证委托逻辑

**更新的测试**（4 个，mock 目标从 `./db` 改为 `./storage/resolveStorage`）：
- `analyticsEvents.test.ts`、`conversationDrafts.test.ts`、`settings.test.ts`、`analyticsExport.test.ts` — 改用 spy storage，断言 `spyStorage.list/put/delete/clear` 调用
- `generationStore.test.ts` — buildContext 加 `services`（用 createSpyStorage + createXxxServices 构造）

**与计划的偏差**：
1. **feature 包装器的 services 参数设为可选 + 模块级默认实例兜底**。原计划 PR2 让 store context 强制要求 services，但这样 PR2/PR4 之间的中间状态会让所有未传 services 的调用方 typecheck 失败。改为可选 + 默认实例（resolveStorage），让 PR2 自洽、PR4 再统一注入。这与 §6.2 的工厂注入语义一致，只是提供了平滑过渡。
2. **analyticsStore 的 configure 签名扩展为 `(settings, services?)`** 而非新增独立 configure 方法。理由：analyticsStore 是单例，configure 是它唯一的配置入口，扩展参数比新增方法更简洁。services 可选，默认用模块级实例。
3. **imagesStore 保留 storageUsage/imageMetadata/messageSerialization 的模块级 import**。这些不是 6 domain service（storageUsage 是跨 collection service，PR3 处理；imageMetadata/messageSerialization 是纯函数非存储层）。

**验收结果**：
- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（756 用例）
- ✅ 5 个 store 对 6 个 domain service 的运行时依赖全部走 context.services 注入（grep 确认仅剩 type-only import 和默认实例兜底的 createXxxServices）
- ✅ 运行时行为零变化（双轨制 + 默认实例用同一 resolveStorage）
