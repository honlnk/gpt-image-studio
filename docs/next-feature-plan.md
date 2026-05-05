# 下一阶段功能开发计划

更新日期：2026-05-06

## 目标

本文档规划当前本地优先图片工作台 MVP 之后的下一轮功能。

近期目标是把图片生成体验升级为更稳定的多任务工作台：

- 用户可以同时发起多个图片请求，不因为一个请求正在生成而阻塞整个应用。
- 图片请求运行期间，即使用户切换对话，也能继续更新发起请求的原对话。
- 每个对话都保留自己独立的输入框草稿、引用图片和基础生成设置。
- 有图片正在生成时，尽量提醒用户不要关闭或刷新网页。
- 图片局部编辑能力可以接入同一套草稿和请求模型。

ChatGPT/Codex 账号登录单独作为架构方向记录。它会改变产品形态，不能当成一个简单的前端功能处理。

## 已确认产品决策

- 同一个对话内允许同时发起多个图片请求。
- 第一版不提供“取消运行中请求”能力。
- 如果生成完成前原对话已被删除，仍然保存生成图片到图片库。
- 新建对话的基础设置来自全局默认设置。
- 局部编辑 mask 草稿第一版只保存在内存中，不跨刷新保留。

## 当前基础

当前项目已经具备一些关键基础：

- 每次生成请求都会在发送时创建一个 `assistantMessage`。
- `assistantMessage` 自身保存了 `conversationId`。
- 请求完成后通过 `replaceMessage` 按消息 id 回写。
- 切换对话只是更新 `activeConversationId`，不会取消已经发出的 `fetch` 请求。
- 因此，当前切换对话不会导致正在生成的请求断开。

当前真正的限制在于：

- `isGenerating` 是全局状态，只要任意对话中有 pending 消息就会返回 true。
- `canSend` 依赖全局 `isGenerating`，导致一个对话正在生成时，所有对话都不能继续发送。
- 输入框文本、引用图片和生成参数都是全局状态，不是对话级状态。
- 刷新或关闭网页仍然会终止浏览器当前持有的请求。

## 第一阶段：并发生成任务

### 目标

允许多个独立图片请求同时运行。每个请求独立完成或失败，并且只更新创建它的那条消息。

第一版不需要真正的后台进程。在浏览器里，用独立的异步任务就足够支撑当前需求。

### 数据模型

增加一个运行时任务类型：

```ts
type GenerationJob = {
  id: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  prompt: string;
  referencedImageIds: string[];
  generationParams: GenerationParams;
  status: "pending" | "success" | "error";
  startedAtMs: number;
  finishedAtMs?: number;
  errorMessage?: string;
};
```

MVP 阶段建议任务只保存在内存中。因为刷新页面仍然会终止浏览器请求，在没有后端可恢复任务之前，把任务持久化成 pending 记录反而会造成误导。

### 状态调整

替换当前全局阻塞模型：

- 保留 `isGenerating`，但只作为全局展示和离开页面保护的派生状态。
- 从 `canSend` 中移除 `isGenerating` 限制。
- 增加 `activeConversationPendingJobs`，用于当前对话的 UI 展示。
- 增加 `pendingJobCount`，用于全局运行中数量展示。

预期行为：

- 一个对话正在生成时，用户可以在另一个对话继续发送请求。
- 同一个对话里，只要输入有效，也可以继续发送新的请求。
- 每条 pending assistant 消息仍然显示自己的生成中状态。

### 请求流程

`submitMessage` 应该：

1. 快照当前对话 id、prompt、引用图片和生成参数。
2. 创建用户消息和 pending assistant 消息。
3. 持久化两条消息。
4. 创建一个 `GenerationJob`。
5. 启动 `runImageRequest(job)`，但不要用会阻塞后续发送的方式等待它完成。

`runImageRequest` 应该：

1. 从 job 中读取所有请求输入。
2. 调用文生图或图片编辑接口。
3. 使用 job 中的 `conversationId` 和 `assistantMessageId` 创建结果图片资源。
4. 通过 `assistantMessageId` 更新对应 assistant 消息。
5. 将 job 标记为成功或失败。

### 删除场景边界

如果某个 job 正在运行时，用户删除了对应对话或 assistant 消息：

- 不要重新创建已删除的消息。
- 即使目标对话已经不存在，也要保存生成结果图到图片库。
- 如果目标 assistant 消息仍然存在，就正常回写消息结果。
- 如果目标 assistant 消息已经不存在，生成图保存为普通图片资产，`conversationId` 和 `messageId` 可以省略或保留已删除记录的历史 id，但 UI 不应依赖它们存在。
- 如果目标对话已经不存在，将 job 标记为结束，并显示非阻塞提示，例如“生成已完成，图片已保存到图片库，原对话已删除。”

第一版不提供主动取消运行中请求的能力。请求取消能力可以作为后续增强再评估。

### UI 调整

- 展示一个轻量的全局运行数量，例如“正在生成 3 张”。
- 消息流里继续保留每条消息自己的 pending 状态。
- 发送按钮只需要在当前点击提交的短暂过程中防重复，不应该因为无关任务长期禁用。
- 会话侧边栏可以考虑给有运行中任务的对话增加小标记。

### 验收标准

- 在对话 A 发起请求后切换到对话 B，请求完成后结果仍出现在对话 A。
- 对话 A 的请求未完成时，可以在对话 B 发起另一个请求。
- 同一个对话里可以在第一张图未完成时继续发起第二个请求。
- 一个请求失败不会影响其它 pending 请求。
- 删除无关对话不会影响正在运行的任务。
- 删除发起请求的原对话后，请求完成时生成图仍会保存到图片库。

## 第二阶段：对话级草稿和基础设置

### 目标

每个对话都记住自己的输入框文本、引用图片和生成参数。

这样每个对话会更像独立工作区，而不只是消息列表的筛选结果。

### 数据模型

新增一个 IndexedDB object store：

```ts
type ConversationDraft = {
  conversationId: string;
  composerText: string;
  attachedImageIds: string[];
  generationParams: GenerationParams;
  maskDraft?: DraftMaskMetadata;
  updatedAtMs: number;
};
```

如果局部编辑不是同阶段一起实现，mask blob 暂时不要持久化。可以先省略 `maskDraft`，或者只保留足够清理异常 UI 状态的元数据。

### IndexedDB 调整

新增 store：

- `conversationDrafts`：以 `conversationId` 作为 key。

这需要提升 `src/services/db.ts` 里的 `DB_VERSION`，并补充 upgrade 逻辑。

新增服务模块：

- `src/services/conversationDrafts.ts`

建议提供这些函数：

- `loadConversationDraft(conversationId)`
- `saveConversationDraft(draft)`
- `deleteConversationDraft(conversationId)`
- `deleteConversationDrafts(conversationIds)`

### 状态调整

把当前全局草稿状态从 localStorage 迁移到对话级 IndexedDB 记录：

- `composerText`
- `attachedImages`
- `activeSizePreset`
- `imageWidth`
- `imageHeight`
- `quality`
- `background`
- `outputFormat`

切换对话时：

1. 保存上一个对话的草稿。
2. 读取下一个对话的草稿。
3. 如果下一个对话没有草稿，则使用应用默认设置初始化。

草稿保存建议加一个短 debounce，避免每次输入都立即写 IndexedDB。

新建对话的基础设置始终来自全局默认设置，不复制上一个活跃对话的临时设置。

### 迁移策略

现有 localStorage 草稿可以作为一次性兼容导入：

- 如果当前对话没有已保存草稿，就用旧 localStorage 值初始化。
- 成功 hydrate 后，后续写入都走 IndexedDB。
- 旧 localStorage key 可以保留一个版本不使用，后续再清理。

### 验收标准

- 对话 A 和对话 B 可以拥有不同的输入框文本。
- 对话 A 和对话 B 可以拥有不同的引用图片。
- 对话 A 和对话 B 可以拥有不同的尺寸、质量、背景和输出格式。
- 刷新页面后可以恢复当前对话草稿。
- 删除单个对话时会删除对应草稿。
- 批量删除对话时会删除对应草稿。

## 第三阶段：刷新和关闭保护

### 目标

当有图片请求正在运行时，用户关闭、刷新或跳转离开页面前，尽量给出提醒。

浏览器对此能力有意做了限制：应用可以触发浏览器原生确认，但不能可靠地自定义弹窗文案。

### 实现方式

当 `pendingJobCount > 0` 时注册 `beforeunload` 监听：

```ts
function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
```

只在存在 pending job 时挂载监听；所有 job 结束后移除监听。

### 页面内提示

应用内部可以显示正常的自定义文案：

- “有图片正在生成。关闭或刷新页面会中断这些请求。”

浏览器确认弹窗本身会使用浏览器控制的固定文案。

### 验收标准

- 没有 pending job 时，刷新页面不会弹出确认。
- 有 pending job 时，刷新页面会触发浏览器确认。
- 所有 job 完成后，监听会被移除。

## 第四阶段：基于遮罩的图片局部编辑

### 目标

实现 `docs/mask-editing-plan.md` 中描述的 MVP，并把它接入新的对话级草稿模型。

### 接入要点

mask 应该属于对话级草稿状态：

- 它绑定一张源图片。
- 只有当引用图片正好为一张时才允许发送。
- 源图片被移除或请求发送后，应该清空 mask。

扩展图片编辑接口入参：

```ts
type EditImageInput = GenerateImageInput & {
  images: Array<{
    blob: Blob;
    name: string;
  }>;
  mask?: {
    blob: Blob;
    name: string;
  };
};
```

第一版建议 mask blob 只保存在内存中。等用户明确需要局部编辑草稿跨刷新保留时，再考虑持久化 mask。

### 验收标准

- 用户可以打开单张图片预览并进入局部编辑模式。
- 用户涂抹区域会导出为 PNG mask 中的透明像素。
- 源图片会作为第一张且唯一一张引用图加入输入框。
- 发送 prompt 时，图片编辑接口会同时携带 `image[]` 和 `mask`。
- 多图局部编辑会被阻止，并给出清晰提示。

## 第五阶段：登录和账号体系方向

### 当前产品边界

当前应用是本地优先浏览器应用，会使用用户提供的 API 设置直接调用 OpenAI 兼容 Images API。

ChatGPT 或 Codex 账号登录不应该被规划成 API key 设置的简单替代品：

- OpenAI API 使用 API key 认证。
- 浏览器应用不应该暴露平台级共享 API key。
- Codex 登录面向 Codex 工具本身，并不会提供一个通用的第三方网页 Images API 调用 token。

### 可行方向

方向 A：继续保留本地优先 API 设置。

- 用户自己提供 API key 和 Base URL。
- 基础设施成本最低。
- 最符合当前架构。
- 浏览器侧保存 API key 仍然是一个需要明确提示的取舍。

方向 B：增加后端代理和自有登录体系。

- 应用自己负责用户登录、额度、限流和计费。
- 后端持有服务商 API key。
- 前端改为调用自己的后端，而不是直接调用 OpenAI。
- 如果目标是“用户不用粘贴 API key”，这是更正确的方向。

方向 C：构建 ChatGPT App。

- 使用体验发生在 ChatGPT 内部。
- 这会是一个独立产品形态，可能需要 Apps SDK 和 MCP server。
- 它不能替代当前独立 Web App 的登录模型。

### 建议

不要让登录功能阻塞下一批本地优先能力。

优先完成并发生成任务、对话级草稿、刷新保护和局部编辑。等这些工作流稳定后，再决定项目是继续保持本地优先，还是转向带后端的托管服务。

## 建议实施顺序

1. 增加生成任务运行时状态，移除全局发送阻塞。
2. 改造 `submitMessage` 和 `runImageRequest`，让请求使用 job 快照。
3. 增加全局 pending 数量 UI 和 `beforeunload` 保护。
4. 新增 `conversationDrafts` IndexedDB store，并实现对话级草稿 hydrate。
5. 把输入框和生成参数迁移到对话级草稿。
6. 在对话级草稿模型上实现局部编辑 MVP。
7. 重新评估登录、后端代理和账号体系。

## 后续可再评估问题

- 是否需要给运行中的请求增加“本地忽略结果”能力，而不是真正取消服务端生成。
- 是否需要在图片库中标记“来自已删除对话的生成图”。
- 是否需要在对话侧边栏展示每个对话的 pending 数量。
- 是否需要在后续版本持久化 mask 草稿。
