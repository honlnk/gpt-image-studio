# 阶段一 PR6：ImageBlobRecord 收敛 + 删除旧 db.ts + 文档收尾

> **状态**：✅ 已完成
> **依赖**：PR1-5 ✅
> **风险**：低（收尾）
> **纲领**：[`evolution-roadmap.md` §6.6](../../plans/evolution-roadmap.md)

## 目标

阶段一收尾：
1. 删除旧 db.ts（无引用，安全）
2. 确认 ImageBlobRecord 类型已统一从 storage 导入
3. 文档收尾，阶段一标记完成

## 改造清单

### 删除文件
- `src/services/db.ts` —— 全部逻辑已搬迁到 `IndexedDbStorage.ts`，全代码库无引用

### 保留的合理入口（不删除）
- service 模块级导出（双轨制兼容入口）：backups/analyticsExport 等编排层仍用它们（`listConversations`/`loadSettings` 等），删除会破坏内部依赖。这些是合法的便利入口，保留不影响"业务代码通过注入"的目标。
- imagesStore 的 `estimateStorageUsage` 模块级 import：它是 storageUsage 编排入口，store 通过它触发容量刷新。PR3 已让 storageUsage 工厂化，模块级导出委托默认实例。

## 阶段一全局验收结果

- ✅ `pnpm typecheck` + `pnpm typecheck:companion` 0 错误
- ✅ `pnpm test` 全绿（756 用例，含 97 个 storage 契约/专项测试）
- ✅ db.ts 已删除，全代码库无引用
- ✅ ImageBlobRecord 统一从 `storage/types` 导入，无本地重复定义
- ✅ store/feature 层的 service import 全部是 createXxxServices 工厂或 import type 或编排入口
- ⚠️ 已回滚：~~companion 凭据已收编到 StudioStorage.config~~（PR5 目标 1 回滚为 localStorage 镜像权威，见 `phase1-pr5-companion-credentials.md` 回滚说明；companion 凭据走 shared/localStorage 封装，无裸 `localStorage.` 直连）
- ✅ ViewModel 是唯一 service 工厂装配点（创建 10 个工厂：8 domain service + 1 config + 1 storageUsage 跨 collection service）
- ✅ 运行时行为零变化（双轨制 + 默认实例用同一 resolveStorage）

## 实施记录

### 2026-07-27 实施完成

删除 `src/services/db.ts`。typecheck + test 全绿（756 用例），确认无任何代码引用 db.ts。

阶段一（6 个 PR）全部完成。前端存储抽象层地基就位，所有业务代码通过 `StudioStorage` 接口访问存储后端，存储后端变得可替换（阶段二/三/四只需换实现不改业务代码）。
