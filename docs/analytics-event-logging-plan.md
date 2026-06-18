# 用户行为日志系统（V1）开发计划

## 实施状态

- **V1.0 已完成**（2026-06）：基础设施 + 核心事件闭环已落地。
  - IndexedDB `analyticsEvents` store、`analyticsEvents` service、模块级 tracker 单例（`src/features/analytics/useAnalyticsTracker.ts`）、`v-track` 指令、`analyticsStore`、设置页「行为日志」面板。
  - 覆盖 §8.1 的 V1.0 事件清单（chat / generation / image / conversation / settings / backup）。
  - 导出采用 JSONL 单文件（§6.3 的 Markdown 分片报告留待 V1.1）。
  - 事件不纳入备份导出/恢复（设备本地运行记录）。
- **V1.1 已完成**（2026-06）：§8.2 高频控件事件 + §6.3 / §11.3 Markdown 时间线分片导出 + `manifest.json`。
  - 补齐 §8.2 的 11 个高频事件（chat.attach_image / chat.remove_attachment / generation.edit_mode_toggled / generation.apply_mask / library.filter_changed / library.sort_changed / library.search_used / batch.images_downloaded / batch.images_deleted / batch.conversations_deleted / settings.tab_changed）。
  - 新增 `src/services/analyticsExport.ts`：导出由单 JSONL 升级为 ZIP 包（manifest.json + README.md + events/raw/events.jsonl + reports/summary.md + reports/timeline/*.md）。
  - 分片算法：先按 7 天时间窗口分组，再按 1000 events / 2 MB 兜底切 part；每片带 YAML frontmatter（§11.3 默认值，V1.1 硬编码不进设置）。
- **V1.2 待开发**：§8.3 颜色分组专项事件（`image.tag_color_*`）+ 会话级分片报告。

> 实施过程中相对原计划的偏差，已固化在代码中：
> 1. tracker 采用「模块级单例 + `analyticsStore` 包装」而非纯 store；`v-track` 指令直接 import 模块级 `track()`，不依赖 Pinia 实例。
> 2. `analyticsStore.eventCount` 暴露给面板时必须经 `storeToRefs` 解构（直接访问 store 实例属性会被解包成静态值，导致计数不更新）。
> 3. `library.sort_changed` / `library.search_used` 的实际控件位于「设置 → 批量操作」面板（`ImageLibrary.vue` 仅有 scope 过滤），按控件实际位置埋点，保留 `library.*` 事件名以对齐事件字典。
> 4. V1.1 分片阈值（7 天 / 1000 events / 2 MB）硬编码在 `analyticsExport.ts` 顶部常量，未暴露为设置项。

## 1. 背景与目标

本项目当前只有少量 `console` 调试输出，不具备可持续分析能力。V1 目标是建设一个本地优先的用户行为日志系统，用于记录用户在产品中的客观操作轨迹，为后续可用性分析与提示词偏好研究提供数据基础。

本计划强调：

- 采集层只记录事实事件，不做心理状态推断。
- 以低侵入改造为原则，避免大面积修改业务方法。
- 默认保护隐私，支持可配置的数据采集粒度。
- 采用迭代路线：先闭环，再扩面，再精细化。

## 2. 范围与非范围

### 2.1 V1 范围

- 记录关键用户行为事件（点击、提交、重试、下载、编辑、删除、重命名、设置变更等）。
- 事件本地持久化（IndexedDB）。
- 提供日志开关、清空、导出能力。
- 为后续分析提供可关联字段（session/conversation/message/image）。

### 2.2 非范围

- 不在采集阶段写入“满意/不满意”等推断字段。
- 不做录屏式日志。
- 不接入远程上报服务（V1 先本地闭环）。

## 3. 设计原则

- 事实优先：仅记录 who/when/where/what。
- 推断后置：why 与满意度指标在分析阶段计算。
- 低侵入：模板标记与统一拦截优先，业务代码最小改动。
- 可扩展：事件模型和存储索引支持后续扩展。
- 可控隐私：默认不保存完整 prompt 原文。

## 4. 总体方案

采用“前端 AOP 替代方案”组合：

1. 统一埋点入口 `track(eventName, payload, context)`。
2. 模板层使用 `v-track` 指令或 `data-track` 标记采集点击行为。
3. 对纯代码触发事件（如生成成功/失败）在少数 composable 中补充调用。
4. 使用 IndexedDB 独立 store 持久化事件。
5. 通过设置面板控制开关与采集粒度。

## 5. 数据模型（V1）

建议新增 `AnalyticsEvent`：

```ts
type AnalyticsEvent = {
  id: string;
  eventName: string;
  occurredAt: string; // ISO 时间
  sessionId: string;
  conversationId?: string;
  messageId?: string;
  imageId?: string;
  source: "ui_click" | "ui_input" | "system";
  payload?: Record<string, unknown>;
};
```

建议新增采集配置：

```ts
type AnalyticsSettings = {
  enabled: boolean;
  promptCapture: "none" | "length_only" | "masked" | "raw";
};
```

默认值建议：

- `enabled = true`
- `promptCapture = "length_only"`

## 6. 存储与服务改造

### 6.1 IndexedDB

在 `src/services/db.ts` 中新增 store：

- `analyticsEvents`

建议索引：

- `occurredAt`
- `eventName`
- `conversationId`

### 6.2 事件服务

新增文件：`src/services/analyticsEvents.ts`

提供能力：

- `saveAnalyticsEvent(event)`
- `saveAnalyticsEventsBatch(events)`
- `listAnalyticsEvents()`
- `queryAnalyticsEventsByTimeRange(start, end)`
- `clearAnalyticsEvents()`
- `exportAnalyticsEvents()`

## 6.3 导出格式与大数据量策略（JSON + Markdown）

导出建议采用“双格式”：

- JSON：机器可稳定消费的事实源数据。
- Markdown：人类与 AI 友好的阅读视图。

核心原则：

- JSON 与 Markdown 必须基于同一批事件生成，避免口径不一致。
- JSON 作为唯一事实源，Markdown 作为可读报告层。
- 对 Markdown 启用分片策略，避免大文件不可读。

推荐导出包格式（ZIP）：

```text
analytics-export-YYYYMMDD-HHmmss.zip
  manifest.json
  README.md
  events/
    raw/
      events.jsonl
  reports/
    summary.md
    timeline/
      timeline_2026-05-01_to_2026-05-07_part-001.md
      timeline_2026-05-01_to_2026-05-07_part-002.md
    conversations/
      conversation_c-123_part-001.md
```

说明：

- `manifest.json`：导出范围、版本、分片索引、文件校验信息。
- `README.md`：快速导航入口。
- `events/raw/events.jsonl`：完整原始事件流。
- `reports/summary.md`：总览统计与分片导航。
- `reports/timeline/*`：按时间线切片的明细报告。
- `reports/conversations/*`：按会话切片的可选明细报告。

## 7. 埋点采集架构

### 7.1 统一入口

新增：`src/features/analytics/useAnalyticsTracker.ts`

职责：

- 组装统一事件结构（补全时间、sessionId、上下文字段）。
- 执行 prompt 脱敏/截断策略。
- 写入批量队列并异步落库。
- 错误降级（埋点失败不影响业务）。

### 7.2 模板层低侵入采集

新增全局指令：`src/directives/track.ts`

用法示例：

```vue
<button v-track="'chat.submit'">发送</button>
<button v-track="{ name: 'image.delete', payload: { location: 'library' } }">删除</button>
```

在 `src/main.ts` 注册该指令。

### 7.3 业务层补充采集

仅在“非点击触发”关键流程中补充少量 `track()`：

- 生成请求开始/成功/失败。
- 备份导入导出成功/失败。
- 批量操作完成事件。

## 8. 迭代版本规划（V1.0 / V1.1 / V1.2）

### 8.1 V1.0：先闭环（最小可用）

目标：快速打通“采集 -> 落库 -> 导出”与核心行为链路。

事件范围：

- `chat.submit`
- `chat.retry`
- `generation.requested`
- `generation.succeeded`
- `generation.failed`
- `image.preview_opened`
- `image.downloaded`
- `image.deleted`
- `image.renamed`
- `conversation.created`
- `conversation.selected`
- `conversation.renamed`
- `conversation.deleted`
- `settings.opened`
- `settings.connection_mode_changed`
- `backup.export_requested`
- `backup.export_succeeded`
- `backup.import_requested`
- `backup.import_succeeded`
- `backup.import_failed`

验收重点：能形成“输入 -> 生成 -> 图片后续操作”的完整事件链。

### 8.2 V1.1：扩展高频控件

目标：在 V1.0 稳定后，补齐高频但非核心链路控件行为。

新增事件建议：

- `chat.attach_image`
- `chat.remove_attachment`
- `generation.edit_mode_toggled`
- `generation.apply_mask`
- `library.filter_changed`
- `library.sort_changed`
- `library.search_used`
- `batch.images_downloaded`
- `batch.images_deleted`
- `batch.conversations_deleted`
- `settings.tab_changed`

导出能力增强（Markdown 切片第一版）：

- 增加 `reports/summary.md` 汇总视图。
- 增加 `reports/timeline/*.md` 时间线分片导出。
- 增加 `manifest.json` 分片目录与导航信息。

验收重点：图片库、批量操作、编辑器参数区域有连续可追踪日志。

### 8.3 V1.2：颜色分组与精细行为专项

目标：补齐“图片颜色分组（用户自定义分类）”全链路行为，服务后续分析。

新增事件建议：

- `image.tag_color_set`
- `image.tag_color_changed`
- `image.tag_color_cleared`
- `library.filter_by_tag_color`

事件 payload 建议：

- `imageId`
- `oldColor`（无则 `null`）
- `newColor`（清除时 `null`）
- `entry`（例如 `image_card`、`image_details_panel`）
- `activeFilter`（触发时当前筛选器）

说明：

- 颜色语义（红色=高满意、紫色=本地导入等）由分析阶段解释。
- 采集阶段只记录颜色变更事实，不写主观标签。

导出能力增强（Markdown 切片第二版）：

- 增加 `reports/conversations/*.md` 会话级分片。
- 增加颜色分组专题视图（例如按颜色聚合的事件摘要）。
- 在 `summary.md` 中增加颜色分组行为导航入口。

验收重点：颜色分类相关行为可完整复盘并可按时间线分析。

## 9. 文件级落地计划

### 9.1 新增文件

- `src/features/analytics/useAnalyticsTracker.ts`
- `src/services/analyticsEvents.ts`
- `src/directives/track.ts`
- `src/types/analytics.ts`（或并入 `src/types/studio.ts`）

### 9.2 修改文件（重点）

- `src/services/db.ts`：新增 `analyticsEvents` store 与索引。
- `src/main.ts`：注册 `v-track` 指令，初始化 tracker。
- `src/app/studio/useStudioViewModel.ts`：注入 tracker，上下文桥接。
- `src/features/generation/useStudioGeneration.ts`：请求生命周期事件。
- `src/features/backup/useStudioBackup.ts`：导入导出生命周期事件。

### 9.3 模板标记改造（低侵入）

按优先级逐步补充 `v-track`：

- `src/components/chat/ChatComposer.vue`
- `src/components/chat/MessageList.vue`
- `src/components/studio/ImageLibrary.vue`
- `src/components/image-library/ImageDetailsPanel.vue`
- `src/components/studio/ConversationSidebar.vue`
- `src/components/studio/SettingsModal.vue`
- `src/components/settings/*`

## 10. 实施阶段（工程任务）

### 10.1 阶段 A：基础设施

- 完成事件类型定义。
- 完成 DB store 与事件服务。
- 完成 tracker 统一入口与批量写入。
- 完成设置项（开关与 prompt 采集级别）。
- 完成 JSON 基础导出（可先单文件导出）。

交付结果：可在代码中调用 `track()` 并稳定落库。

### 10.2 阶段 B：V1.0 事件闭环

- 按 V1.0 清单接入埋点。
- 验证关键事件可串联（session/conversation/message/image）。
- 产出 `README.md + summary.md` 基础阅读报告。

交付结果：主链路可复盘、可导出、可分析。

### 10.3 阶段 C：V1.1 扩展

- 按 V1.1 清单补齐高频控件。
- 优化 payload 上下文信息。
- 实现 Markdown 时间线分片导出与 `manifest.json` 索引。

交付结果：高频操作覆盖率显著提升。

### 10.4 阶段 D：V1.2 颜色分组专项

- 按 V1.2 清单补齐颜色分组行为。
- 对颜色相关事件做专项验证。
- 实现会话级分片与颜色分组专题报告。

交付结果：颜色分类行为可独立分析与复盘。

## 11. 测试与验收

### 11.1 测试建议

- 单测：事件服务 CRUD、批量写入、清空、导出。
- 单测：prompt 采集策略（none/length_only/masked/raw）。
- 集成：提交消息后写入 `chat.submit + generation.requested`。
- 集成：生成成功/失败事件闭环。
- 集成：颜色分组 set/change/clear/filter 事件链。
- 集成：Markdown 分片规则（时间/条数/体积阈值）生效。
- 集成：`manifest.json` 与实际导出文件一一对应。

### 11.2 验收标准

- 关闭采集开关后不再新增事件。
- 关键链路事件可通过 `sessionId + conversationId` 串联。
- 埋点失败不会阻塞业务主流程。
- 页面交互和性能无明显回退。
- V1.2 后颜色分组操作可完整追溯。
- 大数据量导出时 Markdown 会自动切片且可导航。
- 导出包中 JSON 与 Markdown 统计口径一致。

## 11.3 Markdown 分片规范（建议默认值）

- 分片组合策略：先按时间窗口，再按事件条数兜底。
- 默认时间窗口：`7 天`。
- 默认条数上限：`1000 events/文件`。
- 默认体积上限：`2 MB/文件`（超过则强制切分）。
- 每个分片文件头包含统一元信息（建议 YAML frontmatter）：
  - `time_range`
  - `event_count`
  - `session_count`
  - `conversation_count`
  - `part`
  - `total_parts`

## 12. 风险与应对

- 风险：事件量过大影响性能。
  - 应对：批量写入、节流、只采集关键事件。
- 风险：prompt 隐私争议。
  - 应对：默认 `length_only`，设置中可控。
- 风险：埋点命名漂移。
  - 应对：维护统一事件字典与命名规范。
- 风险：一次性覆盖过多控件导致开发压力过高。
  - 应对：严格按 V1.0/V1.1/V1.2 迭代推进。

## 13. 后续（V2）预留

V2 在不改采集层前提下，新增分析层：

- 基于事件计算满意度代理指标。
- 比较不同 prompt 模式下的结果操作分布。
- 输出可用性漏斗与关键路径转化。

V1 不做推断，只保证数据真实、完整、可分析。
