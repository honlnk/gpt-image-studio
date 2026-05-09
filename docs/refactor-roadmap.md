# 重构路线图

本文档记录 GPT Image Studio 下一轮工程结构重构计划。

它不是一次性重写方案，而是一组可以分阶段落地的调整。目标是在不改变现有产品行为的前提下，把项目从“Vue composables 平铺结构”逐步整理为“应用装配层 + 业务模块 + 共享协议 + 可选本地 companion”的结构。

相关文档：

- [架构说明](architecture.md)
- [本地 CLI Companion](companion.md)
- [并发生成任务](generation-jobs.md)
- [连接模式 ADR](decisions/003-connection-modes.md)

## 背景

当前 Web App 已经完成本地优先图片工作台的核心能力：聊天式生成、引用图编辑、IndexedDB 持久化、图片库、备份恢复和批量操作。

当前重构进展（2026-05-10）：

- 阶段一已完成：CI 已统一执行 `typecheck`、`test`、`build`。
- 阶段二已完成：应用入口已迁移为 `src/app/studio/useStudioViewModel.ts`。
- 阶段三已完成：核心业务 composables 已迁移到 `src/features/*`，并补充 feature `index.ts` 入口。

现有结构适合继续按阶段推进：

```text
src/
  app/
  features/
  components/
  composables/
  services/
  types/
```

但后续计划会继续增加几个复杂方向：

- 多个图片生成请求并发运行。
- 每个对话拥有独立输入草稿、引用图片和生成参数。
- 遮罩局部编辑接入草稿和图片编辑流程。
- 浏览器直连 API 与本地 CLI companion 两种连接模式共存。
- Web App 与 companion 共享协议类型。
- 后续可能支持 provider profile、系统 keychain 或更复杂账号能力。

这些方向会让当前 `composables/` 变成越来越重的泛业务层。尤其是 `useStudioState`，它已经更像应用级 composition root 和 view model 工厂，而不是普通的 state composable。

## 目标

本轮重构的目标：

1. 明确应用装配层、业务功能层、共享工具层和未来 companion 的边界。
2. 将 `useStudioState` 改名并移动为 `useStudioViewModel`，承认它的真实职责。
3. 将业务逻辑从平铺 `composables/` 逐步迁移到 `features/`。
4. 抽出图片请求的 `ImageClient` 边界，为 local companion 做准备。
5. 为并发生成任务和对话级草稿预留清晰落点。
6. 新增共享协议包 `packages/protocol`，避免 Web 和 companion 协议漂移。
7. 保持每个阶段都可构建、可测试、可回退。

非目标：

- 不重写 UI。
- 不一次性迁移到完整 monorepo。
- 不立即引入 Pinia。
- 不在同一轮里实现 companion MVP。
- 不改变当前 IndexedDB 数据结构，除非对应阶段明确包含迁移方案。

## 目标结构

短期目标结构：

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
      imageClients/
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

长期如果 Web App 和 companion 需要独立构建、发布或维护，再迁移为：

```text
apps/
  web/
  companion/
packages/
  protocol/
```

完整 monorepo 迁移应该后置，避免现在因为文件搬家产生过多构建和部署噪音。

## 模块入口规则

可以使用 `index.ts` 作为模块门面，但不要给每个目录机械添加。

适合添加 `index.ts` 的位置：

```text
src/app/studio/index.ts
src/features/conversations/index.ts
src/features/generation/index.ts
src/features/images/index.ts
src/features/settings/index.ts
packages/protocol/src/index.ts
```

这些目录有明确的对外 API，`index.ts` 用来表达“这个模块对外暴露什么”。例如：

```ts
export { useStudioViewModel } from "./useStudioViewModel";
export type { StudioViewModel } from "./studioViewModelTypes";
```

外部引用可以写成：

```ts
import { useStudioViewModel } from "./app/studio";
```

不建议添加总入口的位置：

```text
src/components/
src/components/ui/
src/shared/
```

原因：

- 组件引用保持显式，更容易看出页面依赖了哪些组件。
- `shared/index.ts` 容易变成“万物桶”，削弱依赖边界。
- 目录内部文件互相引用时，不应该绕一圈从自己的 `index.ts` 导入。

约定：

- feature module 可以有 `index.ts` 作为公开 API。
- feature 内部文件之间使用相对路径直接引用。
- 跨 feature 引用优先从对方 `index.ts` 引入。
- `shared/` 按具体文件引用，例如 `shared/dateTime`、`shared/objectUrls`。
- `components/` 暂时不做 barrel exports。

## 阶段一：工程护栏

目标：先让后续重构有稳定反馈。

任务：

- GitHub Actions 同时执行 `pnpm run typecheck`、`pnpm test` 和 `pnpm run build`。
- 生产构建中按环境控制 Vue DevTools 插件。
- 评估是否加入格式化工具。可以先只加 Prettier，不急着引入复杂 lint 规则。
- 保留现有 Vitest 测试，并把后续纯逻辑改动优先补测试。

验收标准：

- PR 和 main 分支 CI 都会跑类型检查、单测和构建。
- 本地执行 `pnpm run typecheck`、`pnpm test`、`pnpm run build` 通过。
- 不改变用户可见功能。

## 阶段二：应用入口改名和移动

目标：先把总入口命名和位置调整准确。

任务：

- 将 `src/composables/useStudioState.ts` 移动到 `src/app/studio/useStudioViewModel.ts`。
- 将 `useStudioState` 改名为 `useStudioViewModel`。
- 更新 `App.vue` import。
- 暂时保留返回结构：`chat`、`sidebar`、`library`、`settingsModal`、`preview`、`noticeToast`、`confirmDialog`。
- 将 `useStudioUiState` 移动到 `src/app/studio/useStudioUiState.ts`，因为它是页面级 UI 状态。

暂不做：

- 不同时改 props/events 结构。
- 不同时引入 provide/inject。
- 不重写内部业务逻辑。

验收标准：

- 应用行为不变。
- 类型检查和测试通过。
- `useStudioViewModel` 的职责在文件名和目录上更准确。

## 阶段三：建立 feature modules

目标：把平铺 `composables/` 迁移到按业务域组织的 `features/`。

建议移动：

```text
src/composables/useStudioSettings.ts
  -> src/features/settings/useStudioSettings.ts

src/composables/useStudioConversations.ts
  -> src/features/conversations/useConversations.ts

src/composables/useStudioImages.ts
  -> src/features/images/useImageLibrary.ts

src/composables/useStudioGeneration.ts
  -> src/features/generation/useStudioGeneration.ts

src/composables/useStudioBackup.ts
  -> src/features/backup/useStudioBackup.ts

src/composables/useStudioRestore.ts
  -> src/features/backup/useStudioRestore.ts

src/composables/useStudioFeedback.ts
  -> src/features/feedback/useStudioFeedback.ts
```

可选移动：

```text
src/composables/useNow.ts
  -> src/shared/useNow.ts
```

任务：

- 先以文件移动和 import 更新为主。
- 文件名可以同步去掉不必要的 `Studio` 前缀，但不要为了命名一次性重写所有调用。
- 保持 feature module 内部 API 基本不变。
- 为边界明确的 feature module 添加 `index.ts`，作为跨模块引用的公开入口。
- 在 `docs/architecture.md` 中保持 feature 职责说明同步。

验收标准：

- 目录结构能表达业务边界。
- 跨 feature 引用尽量通过对方 `index.ts`，模块内部引用保持相对路径。
- 应用行为不变。
- 类型检查和测试通过。

## 阶段四：整理 shared 工具

目标：把真正通用的浏览器工具从 `services/` 或 feature 里分离出来。

当前进展（2026-05-10）：

- 已完成第一批迁移：`dateTime`、`objectUrls` 已移动到 `src/shared/`，并完成代码与测试引用更新。

建议移动：

```text
src/services/dateTime.ts
  -> src/shared/dateTime.ts

src/services/objectUrls.ts
  -> src/shared/objectUrls.ts
```

建议新增：

```text
src/shared/id.ts
src/shared/localStorage.ts
src/shared/errors.ts
```

任务：

- 用 `crypto.randomUUID()` 封装统一 ID 生成函数，例如 `createId("img")`、`createId("m")`。
- 用统一 localStorage wrapper 替换散落的 try/catch。
- 用统一错误格式化函数替换重复 `formatError`。
- 保持 IndexedDB 基础 helper 暂时仍在 `services/db.ts`，避免一次搬太多。

验收标准：

- 图片、消息、会话等新 ID 不再依赖 `Date.now()`。
- localStorage 读写逻辑集中。
- Object URL 生命周期工具仍有测试覆盖。
- 类型检查和测试通过。

## 阶段五：抽出图片请求 ImageClient

目标：为浏览器直连和本地 companion 两种连接模式建立统一请求边界。

建议结构：

```text
src/features/generation/imageClients/
  imageClient.ts
  directImagesClient.ts
  localCompanionImagesClient.ts
  imageApiParams.ts
  imageApiResponse.ts
```

核心接口：

```ts
export type ImageClient = {
  generate(input: GenerateImageInput): Promise<string>;
  edit(input: EditImageInput): Promise<string>;
};
```

任务：

- 将当前 `imagesApi.ts` 中的 direct fetch 逻辑迁移到 `directImagesClient`。
- 将参数转换和尺寸校验拆到可测试的纯逻辑文件。
- 暂时实现一个最小 `localCompanionImagesClient` 占位，或者只定义接口和 TODO，不在 UI 中启用。
- `useStudioGeneration` 依赖 `ImageClient`，不直接依赖 `fetch` 和 API URL 细节。

验收标准：

- direct 模式功能不变。
- 现有 `imagesApi` 相关测试迁移或保留后继续通过。
- 后续接入 companion 时，只需要新增 client 和连接设置，不需要重写消息保存流程。

## 阶段六：连接模式和协议预留

目标：把 direct 和 local companion 作为正式概念引入，但默认仍保持 direct。

任务：

- 在设置类型中增加：

```ts
type ConnectionMode = "direct" | "localCompanion";
```

- 旧设置没有 `connectionMode` 时默认使用 `"direct"`。
- 新建 `packages/protocol`，先放纯类型，不引入 Vue、IndexedDB 或浏览器 API。
- 协议包至少包含：

```text
packages/protocol/
  src/
    connection.ts
    companion.ts
    images.ts
```

建议类型：

```ts
export type CompanionHealthResponse = {
  app: "gpt-image-studio-companion";
  version: string;
  paired: boolean;
};

export type CompanionAuthStatus = {
  provider: string;
  mode: "api_key";
  ready: boolean;
  accountLabel: string;
};
```

验收标准：

- 旧用户设置可正常迁移。
- 备份仍然不导出 API key。
- protocol 包不依赖 Web 运行环境。
- direct 模式仍是默认入口。

## 阶段七：生成任务重构

目标：把当前全局阻塞的生成流程改造成支持并发任务的模型。

参考文档：[并发生成任务](generation-jobs.md)。

建议新增：

```text
src/features/generation/useGenerationJobs.ts
src/features/generation/useSubmitGeneration.ts
src/features/generation/generationJobTypes.ts
```

核心类型：

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

任务：

- `submitMessage` 创建消息和 job 后启动异步任务，但不长期阻塞发送按钮。
- `isGenerating` 保留为全局派生状态，用于展示和离开页面保护。
- 新增 `pendingJobCount`。
- 新增当前对话 pending job 派生状态。
- 请求完成后按 `assistantMessageId` 更新消息。
- 如果原对话已删除，生成图仍保存到图片库。

验收标准：

- 对话 A 生成中时，可以切换到对话 B 并继续发起请求。
- 同一对话中可以连续发起多个请求。
- 一个请求失败不会影响其它 pending 请求。
- 删除原对话后，请求完成仍能保存生成图片。
- 有 pending job 时刷新页面触发浏览器离开确认。

## 阶段八：对话级草稿

目标：每个对话拥有独立输入框文本、引用图片和生成参数。

参考文档：[并发生成任务](generation-jobs.md)。

建议新增：

```text
src/features/drafts/
  draftTypes.ts
  draftStore.ts
  useConversationDraft.ts
```

数据模型：

```ts
type ConversationDraft = {
  conversationId: string;
  composerText: string;
  attachedImageIds: string[];
  generationParams: GenerationParams;
  updatedAtMs: number;
};
```

任务：

- 新增 IndexedDB store：`conversationDrafts`。
- 切换会话时保存当前草稿并加载目标会话草稿。
- 没有草稿的新会话使用全局默认设置初始化。
- 旧 localStorage 草稿作为一次性兼容来源。
- 删除会话时删除对应草稿。

验收标准：

- 不同对话可以保留不同输入文本。
- 不同对话可以保留不同引用图片。
- 不同对话可以保留不同生成参数。
- 刷新后恢复当前对话草稿。
- 删除单个或批量对话时清理对应草稿。

## 阶段九：遮罩局部编辑接入新草稿模型

目标：将 mask 编辑接入对话级草稿和图片编辑请求。

参考文档：[遮罩局部编辑](mask-editing.md)。

建议类型：

```ts
type DraftMask = {
  imageId: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};
```

任务：

- 第一版 mask 只保存在内存中，不跨刷新持久化。
- mask 只允许绑定单张引用图。
- `EditImageInput` 增加可选 `mask`。
- 发送前校验 mask 图片 ID、尺寸和 PNG MIME 类型。
- 提交后或引用图变化后清空 mask。

验收标准：

- 用户能从图片预览进入局部编辑模式。
- 完成涂抹后，原图自动成为引用图，mask 保存到当前草稿。
- 发送图片编辑请求时携带 `mask`。
- 校验失败时明确提示，不静默降级为普通编辑。

## 阶段十：本地 companion MVP

目标：在 Web App 结构稳定后，再实现可选 CLI companion。

参考文档：[本地 CLI Companion](companion.md)。

建议结构：

```text
companion/
  src/
    cli.ts
    server.ts
    config/
    pairing/
    security/
    images/
    routes/
```

命令：

```text
gpt-image-studio login
gpt-image-studio serve
gpt-image-studio status
gpt-image-studio logout
```

MVP 范围：

- 本地保存 API Base URL 和 API key。
- 启动 `127.0.0.1` HTTP 服务。
- 支持 `/health`、`/pair/start`、`/pair/confirm`、`/auth/status`。
- 代理 `/images/generations` 和 `/images/edits`。
- Web App 可以切换到 local companion 模式。

安全要求：

- 只监听 `127.0.0.1`。
- 首次连接必须配对。
- 每个请求必须带 session token。
- 校验 Origin 白名单。
- 日志脱敏。
- 限制上传数量、体积和 MIME 类型。
- 不向 Web App 返回真实 API key 或 token。

验收标准：

- 不安装 companion 时，direct 模式仍可使用。
- companion 运行时，Web App 能检测、配对并代理图片生成。
- companion 停止后，Web App 能给出清晰提示并允许切回 direct。
- Web App 无法读取 companion 保存的真实凭据。

## 状态管理策略

短期不引入 Pinia。

理由：

- 当前状态仍集中在单个工作台页面内。
- Composition API store 与现有代码贴合，迁移成本低。
- 当前最大问题是模块边界，而不是缺少状态库。

短期策略：

- 使用 `useStudioViewModel` 作为应用级装配入口。
- 业务状态放到 feature composables。
- 可选用 provide/inject 提供 `StudioContext`，减少 `App.vue` 的 props/events 接线压力。

重新评估 Pinia 的触发条件：

- generation jobs、drafts、connection、settings 等状态变成多个独立 store。
- 需要更强 DevTools 调试。
- 需要更标准化的 store 测试方式。
- 多页面或多入口开始共享同一批状态。

如果引入 Pinia，建议的 store 边界：

```text
settingsStore
conversationsStore
messagesStore
imagesStore
generationJobsStore
draftsStore
connectionStore
```

## 风险与注意事项

- 文件移动会产生较多 import 变更，阶段应该小，避免和功能开发混在一起。
- IndexedDB schema 变更必须配套迁移和测试。
- `ImageAsset.previewUrl` 仍然是内存态字段，不能进入持久化和备份。
- 备份恢复目前不是完全原子操作，后续改动存储层时可以顺手加固。
- companion 相关能力不能变成裸 localhost 代理，安全边界必须先于功能扩张。
- 每个阶段结束都应该跑 `typecheck`、`test`、`build`。

## 推荐执行顺序

1. 工程护栏。
2. `useStudioState` 改名并移动为 `useStudioViewModel`。
3. 建立 `features/` 并迁移现有 composables。
4. 整理 `shared/` 工具。
5. 抽出 `ImageClient`。
6. 增加连接模式和 `packages/protocol`。
7. 重构 generation jobs。
8. 实现对话级草稿。
9. 接入 mask 局部编辑。
10. 实现本地 companion MVP。

这个顺序的重点是：先整理边界，再加新能力。这样后续 companion 和多任务生成进入时，Web App 不需要被迫重写。
