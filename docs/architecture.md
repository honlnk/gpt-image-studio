# 架构说明

GPT Image Studio 是一个本地优先的 AI 图片创作工作台。当前应用是基于 Vue 3 + TypeScript + Vite 的单页 Web App，本地数据主要保存在 IndexedDB。

下一步架构调整不应该是重写，而是从当前偏平的 Vue 项目结构，逐步演进为：应用装配层、业务功能模块、共享浏览器工具，以及可选的本地 CLI companion。

## 当前结构

```text
src/
  app/
  features/
  components/
    chat/
    image-library/
    settings/
    studio/
    ui/
  services/
  shared/
  types/
```

当前结构对 Web MVP 来说是可用的：

- `components/` 按 UI 区域组织 Vue 组件。
- `app/` 承载页面级装配。
- `features/` 承载业务状态和业务编排。
- `services/` 承载 IndexedDB 访问、Images API 调用、ZIP 备份逻辑和浏览器工具。
- `shared/` 承载跨模块复用的通用浏览器工具与纯函数。
- `types/studio.ts` 保存主要业务类型。

目前主要压力点已经从”入口和业务混杂”收敛到”shared 能力边界整理”。应用级入口已经移动到 `src/app/studio/useStudioViewModel.ts`，核心业务 composable 已迁移到 `src/features/*`，Pinia stores 已按领域拆分到 `src/stores/`。Drafts 功能当前以 service 形式存在于 `src/services/conversationDrafts.ts`，未独立为 feature 模块。

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

companion/
```

长期如果 companion 和 Web App 需要独立构建、发布或维护，再迁移为：

```text
apps/
  web/
  companion/
```

这个迁移应该等它能解决真实发布或构建问题时再做。

## App 层

App 层负责页面级装配：

- 创建 Studio 视图模型。
- 连接各个 feature module。
- 向页面暴露面向 UI 的 `chat`、`sidebar`、`library`、`settings`、`preview`、`toast`、`dialog` 等 view model。
- 保存页面级 UI 状态，例如当前面板、弹窗和预览图。

应用级入口是 `src/app/studio/useStudioViewModel.ts`，并通过 `src/app/studio/index.ts` 对外暴露。

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

项目当前已经引入 Pinia，并按领域拆分 store：

```text
src/stores/
  settingsStore.ts
  composerStore.ts
  imagesStore.ts
  conversationsStore.ts
  generationStore.ts
  feedbackStore.ts
```

职责边界：

- Store 管理跨组件共享的业务状态和领域动作。
- `useStudioViewModel` 保留为页面级 orchestration 层，负责草稿切换、备份恢复、预览、重命名弹窗等跨 store 工作流。
- 单组件内部 UI 状态继续留在组件内，例如搜索输入、筛选状态、拖拽深度、mask modal 当前选择等。
- 旧 feature composable 中的 `useStudioSettings`、`useStudioImages`、`useStudioConversations`、`useStudioGeneration`、`useStudioFeedback` 暂时作为兼容 wrapper 保留。

## Companion 边界

Companion 应该是可选能力。浏览器直连模式继续作为默认模式保留。

Companion 不属于 `src/`。它通过明确的 HTTP 协议和 Web App 通信，协议相关类型分别保留在 Web App 与 companion 内部，避免为了简单工具额外发布共享协议包。受信 Origin 可以通过 Companion 凭据管理接口读取和管理普通 Provider API Key；具体信任边界、连接密钥职责和剩余风险以 [ADR 002](decisions/002-companion-security-boundary.md) 为准。
