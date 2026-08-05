# 阶段二 PR8：收尾

> **状态：✅ 已完成（2026-07-27）**

阶段二全部 7 个实施 PR（PR1-7）已合入，本 PR 为收尾文档更新：

## 完成项

1. **evolution-roadmap.md 第七章**：标记阶段二 ✅ 已完成，附实施摘要。
2. **docs/evolution/README.md**：阶段二全部文档状态更新为 ✅。
3. **本 PR8 文档**：记录收尾。

## 阶段二最终交付物

### Companion 后端（companion/src/storage/ + companion/src/routes/）
- SQLite 双层结构（主 db studio.db 的 dataset_registry + 业务 db datasets/<id>.db 的 7 张表）
- 图片存储 adapter（FileSystemImageStore 选项 A/B + OssImageStore 选项 C）
- 数据集管理（fingerprint 去重 + activate 切换 + ensureDefaultDataset 启动兜底）
- /storage/* HTTP 路由（表 CRUD + 图片二进制 + 配置 + 数据集管理 + 容量估算）
- /storage/oss/* 凭据管理路由（loopbackGuard 保护）
- 依赖：better-sqlite3 + ali-oss

### 前端（src/services/storage/ + src/components/settings/）
- CompanionStorage fetch 实现（接入契约测试套件，90 测试用例）
- resolveStorage 按 connectionMode 分叉（localCompanion → CompanionStorage）
- ViewModel 装配顺序调整（先 settingsStore 后 storage，getter 惰性读取）
- StorageLocationPanel.vue 存储位置切换 UI（A/B/C + OSS 配置 + 切换 reload）
- companionApi.ts 新增数据集/OSS 管理 API

### 测试覆盖
- Companion 后端：103 storage 测试 + 31 storage 路由测试 + 33 OSS 测试
- 前端：CompanionStorage 契约测试 90 用例 + resolveStorage 分叉测试
- 全套 1003 测试通过，typecheck（web + companion）0 错误

## 为阶段三铺路
- D7 双层结构 → 阶段三多租户隔离复用（D9：主 db 加 users 表 + dataset_registry 加 user_id 外键，业务 db schema 不动）
- /storage/* 路由 → 阶段三加 JWT 中间件 + user_id 路由分发
- OSS 长期 AK → 阶段三改为 STS 临时凭证（D11）
- 监听 127.0.0.1 → 阶段三改为可配置 + Docker 部署
