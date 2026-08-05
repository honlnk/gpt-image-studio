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
| [phase1-overview.md](./phase1-overview.md) | 阶段一总览：目标、PR 拆分、依赖图、全局验收门槛 | ✅ 已完成 |
| [phase1-pr1-storage-interface.md](./phase1-pr1-storage-interface.md) | PR1：`StudioStorage` 接口 + `IndexedDbStorage` 实现 + 契约测试骨架 | ✅ 已完成 |
| [phase1-pr2-service-factories.md](./phase1-pr2-service-factories.md) | PR2：6 个 domain service 改工厂 + store context 注入 | ✅ 已完成 |
| [phase1-pr3-cross-collection-services.md](./phase1-pr3-cross-collection-services.md) | PR3：backups/storageUsage/timeFieldMigration 改走 storage | ✅ 已完成 |
| [phase1-pr4-feature-assembly.md](./phase1-pr4-feature-assembly.md) | PR4：feature 层 import 改造 + ViewModel 装配点接入 | ✅ 已完成 |
| [phase1-pr5-companion-credentials.md](./phase1-pr5-companion-credentials.md) | PR5：companion 凭据收编 + localStorage 迁移 + 备份更新 | ✅ 已完成 |
| [phase1-pr6-cleanup.md](./phase1-pr6-cleanup.md) | PR6：ImageBlobRecord 收敛 + 删除旧 db.ts + 文档收尾 | ✅ 已完成 |

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
| [phase3-overview.md](./phase3-overview.md) | 阶段三总览：多租户 + SSO + Docker + qiankun | ✅ 已完成 |
| [phase3-pr1-listen-address-docker.md](./phase3-pr1-listen-address-docker.md) | PR1：Companion 监听地址可配置 + Docker 化（部署形态开关） | ✅ 已完成 |
| [phase3-pr2-jwt-multitenant.md](./phase3-pr2-jwt-multitenant.md) | PR2：JWT 认证中间件 + users 表多租户隔离（D9 + D10 SSO 登录） | ✅ 已完成 |
| [phase3-pr3-revocation-slo.md](./phase3-pr3-revocation-slo.md) | PR3：吊销黑名单 SLO + /auth/me + /admin/revoke（D10 完整 SSO） | ✅ 已完成 |
| [phase3-pr4-oss-sts.md](./phase3-pr4-oss-sts.md) | PR4：OSS STS 临时凭证机制（D11 平台统一 OSS） | ✅ 已完成 |
| [phase3-pr5-frontend-qiankun.md](./phase3-pr5-frontend-qiankun.md) | PR5：前端 qiankun 嵌入改造（生命周期 + 运行环境感知 + 认证态联动） | ✅ 已完成 |
| [phase3-pr6-deployment-docs.md](./phase3-pr6-deployment-docs.md) | PR6：部署文档 docs/deployment-guide.md | ✅ 已完成 |
| [phase3-pr7-embed-experience.md](./phase3-pr7-embed-experience.md) | PR7：嵌入态体验增强（URL 会话定位 `?c=` + postMessage 宿主通信 + 高度修复 + 隐藏侧边栏） | ✅ 已完成 |
| [phase3-pr8-host-conversation-list.md](./phase3-pr8-host-conversation-list.md) | PR8：宿主侧会话列表（会话管理外移到宿主，读用 API/写委托子应用，双向 postMessage 协议） | ✅ 已完成 |
| [phase3-pr9-image-loading.md](./phase3-pr9-image-loading.md) | PR9：图片加载性能优化（blob 缓存头 + 预览懒加载优先级队列 + 加载态占位） | ✅ 已完成 |

## Backlog（已识别、部分进行中）

- **server 模式全链路分页**（✅ 主体完成 2026-08-03，PR-a~d + 容量估算聚合已落地）：server 部署到服务器后，Companion `/storage/*` 原来全量返回 conversations/messages/imageAssets，数据量大后需改为分页/增量同步，牵动 API 契约、前端 store、恢复逻辑一整条链。配套还有前端图片库的 DOM 分页/虚拟列表（目前仅 blob 懒加载，元数据和 DOM 仍全量）。与 PR9 的视口懒加载不冲突，是互补的两层。**分析稿：[backlog-server-pagination.md](./backlog-server-pagination.md)**（现状、API/SQL/接口/UI 分层方案、PR 拆分、已拍板决策）。已完成：PR-a Companion 查询能力（`/storage/:table` 游标分页参数 + 真实派生列 schema v2 迁移，契约见 [phase2-pr4-storage-routes.md](./phase2-pr4-storage-routes.md)「分页契约」节）；PR-b `StudioStorage.listPage` 三实现 + T2 修订；PR-c 启动恢复按需加载（消息窗口模型）；PR-d 三列表滚动加载 UI；容量估算改服务端聚合。遗留（后置）：备份导出专用流式接口、虚拟列表。

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
