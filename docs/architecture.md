# 架构说明

GPT Image Studio 是一个本地优先的 AI 图片创作工作台。当前应用是基于 Vue 3 + TypeScript + Vite 的单页 Web App，本地数据主要保存在 IndexedDB。

下一步架构调整不应该是重写，而是从当前偏平的 Vue 项目结构，逐步演进为：应用装配层、业务功能模块、共享浏览器工具、共享协议包，以及可选的本地 CLI companion。

## 当前结构

```text
src/
  components/
    chat/
    image-library/
    settings/
    studio/
    ui/
  composables/
  services/
  types/
```

当前结构对 Web MVP 来说是可用的：

- `components/` 按 UI 区域组织 Vue 组件。
- `composables/` 承载应用状态和业务编排。
- `services/` 承载 IndexedDB 访问、Images API 调用、ZIP 备份逻辑和浏览器工具。
- `types/studio.ts` 保存主要业务类型。

目前主要压力点是 `composables/` 已经变成泛业务层。尤其是 `useStudioState`，它更像应用级 composition root 和 view model 工厂，而不是普通的 state composable。

## 目标结构

短期继续保留 Web App 在 `src/` 下，但把内部边界整理清楚：

```text
src/
  app/
    studio/
      useStudioViewModel.ts
      useStudioUiState.ts

  features/
    backup/
    conversations/
    drafts/
    feedback/
    generation/
    images/
    messages/
    settings/

  components/
    chat/
    image-library/
    settings/
    studio/
    ui/

  shared/
    dateTime.ts
    errors.ts
    id.ts
    localStorage.ts
    objectUrls.ts

  main.ts
  App.vue

packages/
  protocol/

companion/
```

长期如果 companion 和 Web App 需要独立构建、发布或维护，再迁移为：

```text
apps/
  web/
  companion/
packages/
  protocol/
```

这个迁移应该等它能解决真实发布或构建问题时再做。

## App 层

App 层负责页面级装配：

- 创建 Studio 视图模型。
- 连接各个 feature module。
- 向页面暴露面向 UI 的 `chat`、`sidebar`、`library`、`settings`、`preview`、`toast`、`dialog` 等 view model。
- 保存页面级 UI 状态，例如当前面板、弹窗和预览图。

`useStudioState` 后续应该改名为 `useStudioViewModel`，并移动到 `src/app/studio/`。

## Feature 层

Feature module 应该围绕业务概念组织，而不是围绕视觉布局组织。

建议职责划分：

- `conversations`：会话列表、当前会话、新建、删除、选择和摘要更新。
- `messages`：消息持久化和消息领域工具。
- `images`：图片资源、Blob、导入、预览 URL 恢复和存储用量。
- `generation`：生成参数、图片 client、生成任务和请求编排。
- `drafts`：对话级输入草稿、引用图、生成参数，以及未来的 mask 草稿元数据。
- `settings`：应用设置、连接模式和默认生成参数。
- `backup`：备份导出、恢复和备份格式校验。
- `feedback`：通知 toast 和确认弹窗状态。

## Services 与 Shared

当前 `services/` 同时包含领域存储和通用浏览器工具。随着模块迁移，通用工具应该逐步移动到 `shared/`：

- 日期和时间格式化。
- ID 生成。
- localStorage 包装。
- Object URL 生命周期工具。
- 通用错误格式化。

IndexedDB 基础 helper 可以保留为共享基础设施；领域存储 wrapper 后续应逐步移动到对应 feature module 旁边。

## 图片 Client 边界

`generation` feature 不应该直接知道请求是如何传输的，而应该调用统一的 `ImageClient` 接口：

```ts
export type ImageClient = {
  generate(input: GenerateImageInput): Promise<string>;
  edit(input: EditImageInput): Promise<string>;
};
```

第一批 client：

- `directImagesClient`：浏览器直接调用用户配置的 OpenAI 兼容 Images API。
- `localCompanionImagesClient`：浏览器调用已配对的 `127.0.0.1` 本地 companion 服务。

这个边界可以让 Web App 在保持生成流程不变的前提下接入 companion。

## 状态管理方向

项目当前不需要马上切到 Pinia。推荐短期路线：

1. 继续使用 Composition API stores/composables。
2. 将应用级入口改名为 `useStudioViewModel`。
3. 可选增加 `StudioContext`，通过 Vue provide/inject 减少 `App.vue` 的 prop drilling。
4. 等并发生成任务、对话级草稿和 companion 连接状态复杂到需要独立 store 时，再评估是否引入 Pinia。

## Companion 边界

Companion 应该是可选能力。浏览器直连模式继续作为默认模式保留。

Companion 不属于 `src/`，它应该通过 `packages/protocol` 中的显式协议类型和 Web App 通信。Web App 永远不应该读取 companion 中保存的真实凭据。
