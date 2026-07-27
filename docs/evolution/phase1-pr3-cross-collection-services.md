# 阶段一 PR3：backups/storageUsage/timeFieldMigration 改走 storage 接口

> **状态**：✅ 已完成
> **依赖**：PR2 ✅
> **风险**：低（3 个孤立模块）
> **纲领**：[`evolution-roadmap.md` §6.2 跨 collection service](../evolution-roadmap.md)

## 目标

3 个跨 collection service（绕过 domain service 直调 db.ts 的"整库操作"）改走 StudioStorage 接口。

## 改造清单

| service | 当前直调 db.ts 的调用点 | 改造为 |
|---|---|---|
| `backups.ts` | 13 处（getAll/clear/put 跨 5 store） | `createBackupServices(storage)` → { create, restore } |
| `storageUsage.ts` | 6 处 getAll（跨 6 store） | `createStorageUsageServices(storage)` → { estimate } |
| `timeFieldMigration.ts` | 6 处（getAll/put 跨 3 store） | `createTimeFieldMigrationServices(storage)` → { migrate } |

每个保留模块级导出（双轨制，委托 resolveStorage 默认实例），PR6 删除。

### ImageBlobRecord 收敛（PR3 顺手做一部分）

`backups.ts:20` 和 `storageUsage.ts:4` 的本地 `ImageBlobRecord` 定义，改为从 `./storage` 导入统一类型。`imageAssets.ts:5` 的那份留到 PR6 统一删除（PR2 已让它从 storage 导入）。

## 验收门槛

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿
- ✅ 3 个 service 内无 `from "./db"` import（grep 确认）
- ✅ backups/storageUsage/timeFieldMigration 的现有测试改造后通过

## 实施记录

### 2026-07-27 实施完成

**改造的 service**（3 个跨 collection service，全部工厂化 + 保留模块级导出）：
- `backups.ts` — `createBackupServices(storage)` → { create, restore }。13 处 db.ts 调用改为 storage.list/clear/put。本地 `ImageBlobRecord` 定义删除，改从 `./storage` 导入统一类型。
- `storageUsage.ts` — `createStorageUsageServices(storage)` → { estimate }。6 处 getAllFromStore 改为 storage.list。本地 `ImageBlobRecord` 定义删除。
- `timeFieldMigration.ts` — `createTimeFieldMigrationServices(storage)` → { migrate }。6 处 getAll/put 改为 storage.list/put。normalize 纯函数保持不变。

**更新的测试**：
- `backups.test.ts` — mock 目标从 `./db` 改为 `./storage/resolveStorage`（返回 spyStorage）。getAllFromStore→list、clearStore→clear、putInStore→put 的断言全部重定向。`./settings` 的 mock 保留（backups 仍调 loadSettings/saveSettings）。
- `timeFieldMigration.test.ts` — 无需改（测的是 normalize 纯函数，不涉及 db）。

**验收结果**：
- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（756 用例）
- ✅ grep 确认 3 个 service 无 `from "./db"` import
- ✅ ImageBlobRecord 重复定义从 3 处减为 1 处（仅剩 imageAssets.ts，PR6 统一删除）
