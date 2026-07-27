# 阶段一 PR5：companion 凭据收编 + localStorage 迁移 + 备份更新

> **状态**：✅ 已完成
> **依赖**：PR4 ✅
> **风险**：中（涉及敏感凭据 + hydrate 时序，需仔细回归）
> **纲领**：[`evolution-roadmap.md` §6.4](../evolution-roadmap.md) + 决策 T3

## 目标

1. `companionUrl` / `companionAccessKey` 从 localStorage 收编到 `StudioStorage.config`（IndexedDB settings 表 `__config__:` 前缀）
2. `apiKey` / `apiBaseUrl` 废弃 localStorage 入口（一次性迁移到 IndexedDB settings 表，它们本就走 IndexedDB，只是清掉遗留兜底）
3. backups.ts 新增 `stripCompanionCredentials`（companion 凭据进备份但剥离敏感值）
4. 全程对用户无感，不破坏 `useCompanionConnection` 的 immediate watch 时序

## 时序约束分析（子智能体探查结论）

**核心约束**：`useCompanionConnection` 的 `watch(connectionMode, ..., { immediate: true })` 在 store setup 期间同步 flush，依赖 `companionUrl.value` / `companionAccessKey.value` 在任意时刻都有正确值。

**不能采用的方案**：ref 初始值给空 + hydrate 时异步读 config。会在 "config 读回来之前 connectionMode 被改成 localCompanion" 的窗口里发出错误探活。

**采用的方案（对用户无感）**：
- ref 初始值仍同步读 localStorage（兜底，保现状）
- watch 改为写 config（加 isHydrated 守卫，避免迁移前误写）
- restoreFromStorage 最开头插一次性迁移函数
- 新增"hydrate 里 readConfig 回填 ref"（处理已迁移用户的二次启动）

## 改造清单

### 1. ConfigServices 扩展

新增 `createConfigServices(storage)` → { read, write }，封装 `storage.readConfig/writeConfig`。settingsStore 的 configureSettingsStore 扩展接收 config services。

### 2. settingsStore 改造

| 改动点 | 当前 | 改造后 |
|---|---|---|
| ref 声明（L161-166） | `ref(readStorage(...))` 同步读 localStorage | **不变**（同步读 localStorage 兜底） |
| watch 写回（L617-622） | `writeStorage(...)` 写 localStorage | `configServices.write(...)` 写 config，加 isHydrated 守卫 |
| configureSettingsStore | 接收 SettingsServices | 扩展接收 `{ settings, config, isHydrated }` |

### 3. 一次性迁移逻辑（useStudioRestore）

在 `restoreFromStorage` 最开头（早于 timeFieldMigration.migrate）：

```ts
async function migrateCredentialsFromLocalStorage() {
  // 1. 同步读 localStorage 旧值
  // 2. companionUrl/accessKey：若有值，写 config（IndexedDB）
  // 3. apiKey/apiBaseUrl：若有值，合并到即将 load 的 settings（或直接写 settings 表）
  // 4. 清 localStorage 旧 key
  // 5. 同步回填 ref（确保 ref 与 config 一致）
}
```

### 4. hydrate 里 readConfig 回填 ref

迁移完成后（二次启动 localStorage 已清），从 config 读回 companionUrl/accessKey 赋值给 ref。

### 5. backups.ts 新增 stripCompanionCredentials

companionUrl/accessKey 进备份（跨设备迁移需要），但导出时剥离 accessKey（敏感）。与 stripApiKey 同级别。

## 验收门槛

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（含 useCompanionConnection.test.ts 的 immediate 探活测试）
- ✅ 首次启动后 localStorage 的 companion-* key 被清空
- ✅ IndexedDB settings 表可见 `__config__:companionUrl` / `__config__:companionAccessKey` 记录
- ✅ Companion 模式首次探活时序正常（不因迁移导致首屏徽标错乱）
- ✅ 备份导出不包含 companionAccessKey 明文

## 实施记录

### 2026-07-27 实施完成

**采用的迁移方案（对用户无感，基于时序分析）**：
- ref 初始值仍同步读 localStorage（settingsStore L172/175 兜底，保现状）
- watch 写回改为写 config（IndexedDB `__config__:` 前缀），加 isHydrated 守卫
- restoreFromStorage 最开头执行 migrateCredentials（一次性迁移 + 二次启动 config 回填）
- backups.ts companionUrl 进备份、accessKey 剥离

**改造点**：

1. **ConfigServices 工厂**（`services/settings.ts`）：新增 `createConfigServices(storage)` → { read, write }，封装 storage.readConfig/writeConfig。

2. **settingsStore 改造**：
   - `configureSettingsStore` 签名扩展为接收 `{ services, config, isHydrated }`
   - companionUrl/companionAccessKey 的 watch 从 `writeStorage(localStorage)` 改为 `configServices.write(IndexedDB)`，加 `isHydratedRef?.value` 守卫（迁移完成前不写，避免覆盖）
   - ref 初始值保留 `readStorage(...)` 同步兜底（时序安全）

3. **useStudioRestore 加 migrateCredentials**（restoreFromStorage 最开头，早于 timeFieldMigration）：
   - companionUrl/accessKey：localStorage 有旧值 → 写 config + 清 localStorage；无旧值 → 从 config 读回填 ref（二次启动）
   - apiKey/apiBaseUrl：只清 localStorage 遗留入口（运行时持久化本就走 IndexedDB settings 表）
   - 迁移失败不阻塞 hydrate（ref 兜底值仍在）

4. **useStudioSettings 包装器**：透传 config services + isHydrated 给 configureSettingsStore

5. **ViewModel 装配**：services 全集加 `config: createConfigServices(storage)`，注入 settings 和 restore

6. **backups.ts 备份更新**：
   - BackupData 加 companionUrl/companionAccessKey 字段
   - create 读 config 的 companionUrl/accessKey，但**只导出 companionUrl**（accessKey 不写入备份，等价 stripCompanionCredentials）
   - manifest.excludes 改为 `["apiKey", "companionAccessKey"]`
   - restore 把 companionUrl 写回 config

**时序安全验证**（子智能体分析结论已落地）：
- store setup（同步读 localStorage 兜底）→ useCompanionConnection immediate watch（用兜底值，默认 direct 模式不探活）→ onMounted restoreFromStorage → migrateCredentials（同步读 localStorage→写 config→清 localStorage→回填 ref）→ settings.load + applySettings（不触碰 companion ref，它们不在 AppSettings 里）→ isHydrated=true（watch 守卫放开）
- 二次启动：localStorage 已清，ref 初始值是默认值，migrateCredentials 从 config 读回值回填 ref，accessKey watch 触发一次探活（期望行为）

**更新的测试**：
- `backups.test.ts` — manifest.excludes 断言改为 `["apiKey", "companionAccessKey"]`

**验收结果**：
- ✅ typecheck/test 全绿（756 用例，含 useCompanionConnection.test.ts 的 immediate 探活测试）
- ✅ settingsStore 内 companion 凭据的 writeStorage 全部移除（watch 改写 config）
- ✅ 全局无 `localStorage.` 直连（companion 凭据已收编）
- ✅ migrateCredentials 逻辑完整（迁移 + 回填 + 清理）
- ✅ 备份导出不含 companionAccessKey（敏感凭据剥离）
