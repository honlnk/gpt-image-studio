# GPT Image Studio 文档

这个目录用于维护项目的长期设计、路线图、架构决策和迁移记录。文档结构按“当前事实优先、历史计划归档”的原则组织，避免后续开发时被旧计划干扰。

## 当前文档

- [架构说明](architecture.md)：当前项目结构、目标结构和模块边界。
- [产品路线图](roadmap.md)：产品方向和阶段性功能规划。
- [本地 CLI Companion](companion.md)：本地伴侣的设计、协议、安全要求和分阶段计划。
- [遮罩局部编辑](mask-editing.md)：基于本地遮罩绘制的图片局部编辑方案。
- [提示词模式开发计划](prompt-modes.md)：安全、创意、成人三级提示词模式的设计和实现计划。
- [Responses API 与流式图片预览开发方案](responses-streaming-plan.md)：浏览器直连模式下接入 `Responses API` 与流式图片预览的设计和实施计划。
- [备份格式](backup-format.md)：当前备份 ZIP 结构和恢复行为。
- [用户行为日志计划](analytics-event-logging-plan.md)：后续本地行为日志系统方案。

## 架构决策

- [ADR 001：本地优先 Web App](decisions/001-local-first-web-app.md)
- [ADR 002：Companion 安全边界](decisions/002-companion-security-boundary.md)
- [ADR 003：连接模式](decisions/003-connection-modes.md)

## 维护记录

- [时间字段迁移](migrations/time-field-migration.md)：旧时间字段兼容和移除条件。

## 历史归档

[archive](archive/) 目录保存已经完成的计划和历史重构记录。这些文档可以作为背景材料，但不应该覆盖当前文档中的架构和路线图。
