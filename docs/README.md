# GPT Image Studio 文档

文档目录按用途分为七类，遵循「当前事实优先、历史计划归档」的原则。

## 推荐阅读顺序

1. [架构说明](architecture/architecture.md) — 项目结构、目标结构和模块边界
2. [产品路线图](plans/roadmap.md) — 业务功能演进
3. [架构演进路线图](plans/evolution-roadmap.md) — 存储抽象 / Companion 后端化 / 子项目化 / APP 化的四阶段纲领
4. [本地 Companion 方案](companion/companion.md) — 设计、协议、安全要求

## Architecture

当前事实文档（描述系统现在是什么样）。

| 文档 | 说明 |
| :--- | :--- |
| [架构说明](architecture/architecture.md) | 当前项目结构、目标结构、模块边界 |
| [备份格式](architecture/backup-format.md) | 当前备份 ZIP 结构、manifest 内容、恢复行为 |
| [遮罩局部编辑](architecture/mask-editing.md) | 基于本地遮罩绘制的图片局部编辑方案（已落地） |
| [各 Provider 参考图限制](architecture/provider-reference-image-limits.md) | 各图像生成 Provider 对参考图的数量、大小和格式限制 |

## Plans

开发计划和路线图（描述怎么做、往哪走）。

| 文档 | 说明 |
| :--- | :--- |
| [计划索引](plans/README.md) | 按状态（已完成 / 进行中 / 待开始）维护功能计划 |
| [产品路线图](plans/roadmap.md) | 业务功能演进（聊天 UI、图片编辑、备份、分析、提示词模式等） |
| [架构演进路线图](plans/evolution-roadmap.md) | 四阶段纲领，与业务 roadmap 正交。阶段一至三已完成 |
| [用户行为日志计划](plans/analytics-event-logging-plan.md) | 本地行为日志系统方案（V1 已完成） |
| [提示词模式计划](plans/prompt-modes.md) | 默认 / 安全 / 创意 / 开放四档提示词模式（已落地） |
| [Responses API 流式预览](plans/responses-streaming-plan.md) | 浏览器直连模式接入 Responses API + 流式图片预览（已落地） |

## Companion

Companion 子系统文档（本地 CLI 伴侣的设计、Provider 适配层、安全边界）。

| 文档 | 说明 |
| :--- | :--- |
| [Companion 文档导航](companion/README.md) | Companion 子系统文档索引 |
| [本地 CLI Companion 方案](companion/companion.md) | 设计、协议、安全要求、分阶段计划 |
| [多 Provider 翻译层方案](companion/companion-providers-plan.md) | OpenAI / GLM / 豆包 / Qwen / Wan / Grok / Gemini / Gemini-OpenAI / DeepInfra 共 9 个 Provider |
| [豆包 Provider 方案](companion/companion-doubao-plan.md) | 火山方舟 Seedream adapter 独立设计 |
| [多模型适配层审查](companion/companion-provider-adapter-review.md) | 架构审查、安全决策、风险和整改建议 |

## Guides

操作指南（面向维护者和部署者）。

| 文档 | 说明 |
| :--- | :--- |
| [部署指南](guides/deployment-guide.md) | Companion server 模式部署、Docker 编排、JWT 多租户配置 |
| [发布指南](guides/release-guide.md) | npm 包与 Docker 镜像的 tag 驱动发布流程 |
| [桌面端打包](guides/desktop-packaging.md) | Tauri v2 集成、构建命令和后续路线 |
| [阶段一测试清单](guides/phase1-test-checklist.md) | 翻译层骨架 + 能力驱动 UI 的手动验证步骤 |

## Decisions

架构决策记录（ADR）。

| 文档 | 说明 |
| :--- | :--- |
| [ADR 001：本地优先 Web App](decisions/001-local-first-web-app.md) | 数据全部存在本地，不依赖云端 |
| [ADR 002：Companion 安全边界](decisions/002-companion-security-boundary.md) | 网络边界、连接密钥与 JWT、Provider 凭据管理 |
| [ADR 003：连接模式](decisions/003-connection-modes.md) | direct / localCompanion / server 三种连接形态 |

## Reviews

审查与复盘报告。

| 文档 | 说明 |
| :--- | :--- |
| [重构审查报告 2026-07-27](reviews/refactor-review-2026-07-27.md) | imagesApi 拆分、shared/services 工具模块、Provider 层、UI 重构、Store/ViewModel 审查 |

## Migrations

数据迁移记录。

| 文档 | 说明 |
| :--- | :--- |
| [时间字段迁移](migrations/time-field-migration.md) | 旧时间字段兼容和移除条件 |

## Archive

已完成阶段使命、仅保留历史参考价值的文档。

| 文档 | 说明 |
| :--- | :--- |
| [Archive 索引](archive/README.md) | 历史重构记录（Pinia 迁移、Generation Jobs、Refactor Roadmap 等） |
| [架构演进施工记录](archive/evolution/README.md) | 阶段一/二/三全部 PR 的施工记录（StudioStorage 抽象 → Companion 后端化 → 服务化与可嵌入） |

## 维护规则

- 当前事实优先更新 `architecture/` 下的文档。
- 长期产品方向更新 `plans/roadmap.md`，架构形态方向更新 `plans/evolution-roadmap.md`。
- 阶段性功能计划和重构计划放入 `plans/`，并在 `plans/README.md` 维护状态。
- Companion 子系统相关的设计、方案和审查放入 `companion/`。
- 部署、发布、打包等操作流程放入 `guides/`。
- 已做出的关键取舍放入 `decisions/`，不要混在进度文档里。
- 已完成阶段使命但仍有回溯价值的材料放入 `archive/`。
