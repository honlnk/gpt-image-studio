# 架构演进实施计划

> 本目录是 [`evolution-roadmap.md`](../evolution-roadmap.md) 的**执行落地层**。
> - `evolution-roadmap.md` 是**纲领**（为什么做、做成什么样、决策依据）。
> - 本目录是**施工图**（按什么顺序做、每一步具体改哪些文件、验收门槛是什么）。
>
> 两层分离的好处：纲领稳定（架构决策不轻易变），施工图可迭代（每个 PR 完成后更新进度、记录偏差）。

## 文档地图

### 阶段一：前端存储抽象层（地基）

| 文档 | 内容 | 状态 |
|---|---|---|
| [phase1-overview.md](./phase1-overview.md) | 阶段一总览：目标、PR 拆分、依赖图、全局验收门槛 | 🚧 进行中 |
| [phase1-pr1-storage-interface.md](./phase1-pr1-storage-interface.md) | PR1：`StudioStorage` 接口 + `IndexedDbStorage` 实现 + 契约测试骨架 | ⬜ 待启动 |
| [phase1-pr2-service-factories.md](./phase1-pr2-service-factories.md) | PR2：6 个 domain service 改工厂 + store context 注入 | ⬜ 待启动 |
| [phase1-pr3-cross-collection-services.md](./phase1-pr3-cross-collection-services.md) | PR3：backups/storageUsage/timeFieldMigration 改走 storage | ⬜ 待启动 |
| [phase1-pr4-feature-assembly.md](./phase1-pr4-feature-assembly.md) | PR4：feature 层 import 改造 + ViewModel 装配点接入 | ⬜ 待启动 |
| [phase1-pr5-companion-credentials.md](./phase1-pr5-companion-credentials.md) | PR5：companion 凭据收编 + localStorage 迁移 + 备份更新 | ⬜ 待启动 |
| [phase1-pr6-cleanup.md](./phase1-pr6-cleanup.md) | PR6：ImageBlobRecord 收敛 + 删除旧 db.ts + 文档收尾 | ⬜ 待启动 |

### 阶段二：Companion 后端化（真实数据）

| 文档 | 内容 | 状态 |
|---|---|---|
| [phase2-overview.md](./phase2-overview.md) | 阶段二总览：SQLite + 文件/OSS 存储 + 数据集管理 | ✅ 已完成 |
| [phase2-pr1-sqlite-infra.md](./phase2-pr1-sqlite-infra.md) | PR1：Companion 侧 SQLite 基础设施（主 db + 业务 db + schema + CRUD） | ✅ 已完成 |
| [phase2-pr2-filesystem-image-store.md](./phase2-pr2-filesystem-image-store.md) | PR2：图片 adapter FileSystemImageStore（选项 A/B） | ✅ 已完成 |
| [phase2-pr3-dataset-registry.md](./phase2-pr3-dataset-registry.md) | PR3：数据集管理（datasetRegistry + fingerprint + 激活切换） | ✅ 已完成 |
| [phase2-pr4-storage-routes.md](./phase2-pr4-storage-routes.md) | PR4：Companion 侧 /storage/* 路由 + 集成测试 | ✅ 已完成 |
| [phase2-pr5-oss-image-store.md](./phase2-pr5-oss-image-store.md) | PR5：OssImageStore（选项 C）+ OSS 凭据录入 | ✅ 已完成 |
| [phase2-pr6-companion-storage-frontend.md](./phase2-pr6-companion-storage-frontend.md) | PR6：前端 CompanionStorage 填充 + resolveStorage 切换 | ✅ 已完成 |
| [phase2-pr7-storage-location-ui.md](./phase2-pr7-storage-location-ui.md) | PR7：前端存储位置 UI + 切换 reload 逻辑 | ✅ 已完成 |
| [phase2-pr8-cleanup.md](./phase2-pr8-cleanup.md) | PR8：收尾（文档、README、evolution-roadmap 标记完成） | ✅ 已完成 |

### 阶段三：服务化与可嵌入（多用户 SaaS）

| 文档 | 内容 | 状态 |
|---|---|---|
| [phase3-overview.md](./phase3-overview.md) | 阶段三总览：多租户 + SSO + Docker + qiankun | ⬜ 待启动 |

## 阅读顺序

1. 先读 [`../evolution-roadmap.md`](../evolution-roadmap.md) 第六/七/八章理解阶段设计动机与决策。
2. 进入某阶段时，先读该阶段 `overview.md` 把握全局。
3. 实施某个 PR 前，读对应 `prN-*.md`，按其中的「改造清单」「验收门槛」「回滚策略」执行。
4. 每个 PR 合并后，在对应文档末尾追加「实施记录」段（实际改了什么、与计划的偏差、遗留问题）。

## 状态标记约定

- ⬜ 待启动
- 🚧 进行中
- ✅ 已完成
- ⏸️ 暂停/阻塞（注明原因）
- ❌ 已废弃（注明替代方案）

## 与 roadmap.md 的关系

- [`../roadmap.md`](../roadmap.md)：**业务功能**演进（做什么功能）。
- [`../evolution-roadmap.md`](../evolution-roadmap.md) + 本目录：**架构形态**演进（以什么形态交付）。

两者正交。业务功能迭代优先保证"用户可见行为不变"；架构演进优先保证"接口对齐"。
