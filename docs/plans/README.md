# 计划索引

这个目录维护产品路线图、架构演进纲领和阶段性功能计划。

计划文档不使用连续编号，优先使用清晰的中文标题。编号更适合不可频繁改名的决策记录；计划会随着实现、拆分、合并和归档而调整，用状态分组更容易维护。

## 已完成

| 文档 | 状态 | 说明 |
| :--- | :--- | :--- |
| [用户行为日志计划](analytics-event-logging-plan.md) | V1 已完成 | V1.0 核心事件 + V1.1 高频控件 + V1.2 颜色分组专项全部落地 |
| [提示词模式计划](prompt-modes.md) | 已落地 | 默认 / 安全 / 创意 / 开放四档 PromptMode，`promptBuilder.ts` 请求前包装 |
| [Responses API 流式预览](responses-streaming-plan.md) | 已落地 | 浏览器直连模式 Images API ↔ Responses API 切换 + SSE partial image 预览 |

## 持续维护

| 文档 | 状态 | 说明 |
| :--- | :--- | :--- |
| [产品路线图](roadmap.md) | 持续 | 业务功能演进（聊天 UI、图片编辑、备份、分析、提示词模式等），第一到第五阶段已完成 |
| [架构演进路线图](evolution-roadmap.md) | 持续 | 四阶段纲领（存储抽象 / Companion 后端化 / 子项目化 / APP 化），阶段一至三已完成，阶段四待启动 |

## 已归档

以下计划的施工记录已完成阶段使命，移入 `../archive/`：

- **架构演进施工记录**（阶段一/二/三全部 PR）→ [`../archive/evolution/`](../archive/evolution/README.md)
- **Pinia 迁移**、**Generation Jobs**、**Refactor Roadmap** 等 → [`../archive/`](../archive/README.md)

## 维护规则

1. 新的大功能、重构或跨模块调整，先在这里建计划文档。
2. 计划正在执行但仍有未完成项，放入「已完成」并在状态列注明尾项。
3. 所有验收点完成后，在状态列标注「已落地」或「V1 已完成」。
4. 被新文档吸收或不再需要执行的计划，移动到 `../archive/`，并在这里保留归档去向。
